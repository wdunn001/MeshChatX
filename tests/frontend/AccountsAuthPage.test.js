import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AccountsAuthPage from "../../meshchatx/src/frontend/components/auth/AccountsAuthPage.vue";

const accountsI18n = {
    "accounts.altcha_pending": "Proving you're not a robot. This can take a few seconds on a phone.",
    "accounts.altcha_failed": "That verification failed. Try again.",
    "accounts.altcha_unavailable": "The verification widget did not load. Reload the page and try again.",
};

describe("AccountsAuthPage.vue", () => {
    let axiosMock;
    let routerMock;

    // Both /api/v1/multiuser/status and /api/v1/auth/status are read on
    // mount (the latter for the altcha_enabled flag, the same channel
    // AuthPage.vue reads for the single-user page), so the mock has to
    // branch on the requested path rather than return one fixed body.
    const respondFor = (multiuserBody, authBody) => (path) => {
        if (path === "/api/v1/auth/status") {
            return Promise.resolve({ data: authBody });
        }
        return Promise.resolve({ data: multiuserBody });
    };

    beforeEach(() => {
        axiosMock = {
            get: vi.fn(
                respondFor(
                    { registration_open: true, accounts: 1, signed_in: false },
                    { altcha_enabled: false },
                ),
            ),
            post: vi.fn().mockResolvedValue({ data: { message: "Welcome" } }),
        };
        window.api = axiosMock;

        routerMock = { push: vi.fn() };

        Object.defineProperty(window, "location", {
            value: { href: "" },
            writable: true,
        });
    });

    afterEach(() => {
        delete window.api;
        vi.clearAllMocks();
    });

    const mountPage = () => {
        return mount(AccountsAuthPage, {
            global: {
                mocks: {
                    $router: routerMock,
                    $t: (key) => accountsI18n[key] || key,
                },
                config: {
                    compilerOptions: {
                        isCustomElement: (tag) => tag === "altcha-widget",
                    },
                },
            },
        });
    };

    // Stubs verify()/reset() on the real "altcha" custom element rather than
    // swapping out $refs.altchaWidget for a fake object: the real PoW/network
    // work neither is available in jsdom, but Vue re-associates the ref with
    // this same DOM node on every re-render (a reactive change such as
    // "busy" is enough), which would silently undo a wholesale $refs
    // replacement before a later await (e.g. resetAltcha() after the POST)
    // gets to read it. Patching the element's own methods survives that,
    // since it is still the very same node.
    const stubAltchaWidget = (wrapper, { verify, reset } = {}) => {
        const el = wrapper.find("altcha-widget").element;
        // The real element defines verify/reset as getter-only accessors on
        // its prototype, so a plain assignment throws; defineProperty shadows
        // them with an own, writable property instead.
        Object.defineProperty(el, "verify", {
            configurable: true,
            value: verify || vi.fn().mockResolvedValue({ payload: "solved-payload" }),
        });
        Object.defineProperty(el, "reset", {
            configurable: true,
            value: reset || vi.fn(),
        });
        return el;
    };

    it("does not render the widget or gate submission when altcha is not configured", async () => {
        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.vm.altchaEnabled).toBe(false);
        expect(wrapper.find("altcha-widget").exists()).toBe(false);

        wrapper.vm.mode = "login";
        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/multiuser/login", {
            username: "alice",
            password: "correct-horse",
        });
    });

    it("renders the widget and gates submission when the server reports altcha is enabled", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 0, signed_in: false },
                { altcha_enabled: true },
            ),
        );
        window.api = axiosMock;

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.altchaEnabled).toBe(true);
        expect(wrapper.find("altcha-widget").exists()).toBe(true);
        // Nobody has an account yet, so the page defaults to registration.
        expect(wrapper.vm.mode).toBe("register");

        const verify = vi.fn().mockResolvedValue({ payload: "solved-payload" });
        stubAltchaWidget(wrapper, { verify });

        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(verify).toHaveBeenCalled();
        expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/multiuser/register", {
            username: "alice",
            password: "correct-horse",
            altcha: "solved-payload",
        });
    });

    it("shows a pending state while the widget is verifying", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 1, signed_in: false },
                { altcha_enabled: true },
            ),
        );
        window.api = axiosMock;

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.altchaPending).toBe(false);
        wrapper.vm.onAltchaStateChange({ detail: { state: "verifying" } });
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.altchaPending).toBe(true);
        expect(wrapper.text()).toContain("Proving you're not a robot");
    });

    it("blocks submission and surfaces a readable error when verification fails", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 1, signed_in: false },
                { altcha_enabled: true },
            ),
        );
        window.api = axiosMock;

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        stubAltchaWidget(wrapper, { verify: vi.fn().mockResolvedValue(null) });

        wrapper.vm.mode = "login";
        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(axiosMock.post).not.toHaveBeenCalled();
        expect(wrapper.vm.error).toBe("That verification failed. Try again.");
        expect(wrapper.vm.busy).toBe(false);
    });

    it("resets the widget so a rejected attempt is not retried with a spent solution", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 1, signed_in: false },
                { altcha_enabled: true },
            ),
        );
        axiosMock.post = vi.fn().mockRejectedValue({
            response: { data: { error: "ALTCHA verification failed", code: "altcha_replayed" } },
        });
        window.api = axiosMock;

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        // Mode is already "login" for this mock (accounts: 1), so nothing
        // reactive changes between stubbing the ref and calling submit: a
        // render in between would let Vue's own ref binding put the real
        // widget element back before resetAltcha() runs.
        expect(wrapper.vm.mode).toBe("login");
        const reset = vi.fn();
        stubAltchaWidget(wrapper, {
            verify: vi.fn().mockResolvedValue({ payload: "solved-payload" }),
            reset,
        });

        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(wrapper.vm.error).toBe("ALTCHA verification failed");
        expect(reset).toHaveBeenCalled();
        expect(wrapper.vm.busy).toBe(false);
    });
});
