import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AccountsAuthPage from "../../meshchatx/src/frontend/components/auth/AccountsAuthPage.vue";
import { solveStampChallenge } from "../../meshchatx/src/frontend/js/stampChallenge.js";

// The real solveStampChallenge fetches a challenge over the network and
// solves it in wasm, neither of which is available (or wanted) in jsdom.
// Mocking the whole module keeps the test at the same level the old altcha
// tests stubbed the <altcha-widget> element's verify()/reset() methods:
// this component's own gating and error handling, not the solver itself.
vi.mock("../../meshchatx/src/frontend/js/stampChallenge.js", () => ({
    solveStampChallenge: vi.fn(),
}));

const accountsI18n = {
    "accounts.stamp_pending": "Proving you're not a robot. This can take a few seconds on a phone.",
    "accounts.stamp_progress": "{attempts} attempts, {seconds}s so far",
    "accounts.stamp_failed": "That proof of work failed. Try again.",
    "accounts.stamp_unavailable": "Proof of work could not run in this browser. Reload the page and try again.",
};

function translate(key, params) {
    let text = accountsI18n[key] || key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, v);
        }
    }
    return text;
}

const SOLVED_PROOF = {
    material: "aa".repeat(32),
    cost: 17,
    expand_rounds: 25,
    expires_at: 9999999999,
    signature: "sig",
    stamp: "bb".repeat(32),
};

describe("AccountsAuthPage.vue", () => {
    let axiosMock;
    let routerMock;

    // Both /api/v1/multiuser/status and /api/v1/auth/status are read on
    // mount (the latter for the stamp_auth_enabled flag, the same channel
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
                    { stamp_auth_enabled: false },
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

        solveStampChallenge.mockReset();
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
                    $t: translate,
                },
            },
        });
    };

    it("does not solve a stamp or gate submission when stamp auth is not configured", async () => {
        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.vm.stampAuthEnabled).toBe(false);

        wrapper.vm.mode = "login";
        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(solveStampChallenge).not.toHaveBeenCalled();
        expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/multiuser/login", {
            username: "alice",
            password: "correct-horse",
        });
    });

    it("solves a stamp and attaches it to the request when the server reports stamp auth is enabled", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 0, signed_in: false },
                { stamp_auth_enabled: true },
            ),
        );
        window.api = axiosMock;
        solveStampChallenge.mockResolvedValue(SOLVED_PROOF);

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.stampAuthEnabled).toBe(true);
        // Nobody has an account yet, so the page defaults to registration.
        expect(wrapper.vm.mode).toBe("register");

        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(solveStampChallenge).toHaveBeenCalledWith(
            "/api/v1/auth/stamp/challenge",
            expect.any(Function),
        );
        expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/multiuser/register", {
            username: "alice",
            password: "correct-horse",
            stamp_proof: SOLVED_PROOF,
        });
    });

    it("shows a pending state with live progress while solving", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 1, signed_in: false },
                { stamp_auth_enabled: true },
            ),
        );
        window.api = axiosMock;

        let releaseSolve;
        let reportProgress;
        solveStampChallenge.mockImplementation((_url, onProgress) => {
            reportProgress = onProgress;
            return new Promise((resolve) => {
                releaseSolve = () => resolve(SOLVED_PROOF);
            });
        });

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.solving).toBe(false);

        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        const submitPromise = wrapper.vm.submit();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.solving).toBe(true);
        reportProgress({ attempts: 12345, elapsedMs: 2300 });
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Proving you're not a robot");
        expect(wrapper.text()).toContain("12345 attempts, 2.3s so far");

        releaseSolve();
        await submitPromise;
        expect(wrapper.vm.solving).toBe(false);
    });

    it("blocks submission and surfaces a readable error when the wasm solver is unavailable", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 1, signed_in: false },
                { stamp_auth_enabled: true },
            ),
        );
        window.api = axiosMock;
        solveStampChallenge.mockRejectedValue(new Error("stamp_wasm_unavailable"));

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        wrapper.vm.mode = "login";
        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(axiosMock.post).not.toHaveBeenCalled();
        expect(wrapper.vm.error).toBe(
            "Proof of work could not run in this browser. Reload the page and try again.",
        );
        expect(wrapper.vm.busy).toBe(false);
    });

    it("solves a fresh stamp on retry rather than reusing a rejected (spent) one", async () => {
        axiosMock.get = vi.fn(
            respondFor(
                { registration_open: true, accounts: 1, signed_in: false },
                { stamp_auth_enabled: true },
            ),
        );
        axiosMock.post = vi.fn().mockRejectedValue({
            response: { data: { error: "Stamp verification failed", code: "stamp_replayed" } },
        });
        window.api = axiosMock;
        solveStampChallenge.mockResolvedValue(SOLVED_PROOF);

        const wrapper = mountPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        wrapper.vm.mode = "login";
        wrapper.vm.username = "alice";
        wrapper.vm.password = "correct-horse";
        await wrapper.vm.submit();

        expect(wrapper.vm.error).toBe("Stamp verification failed");
        expect(wrapper.vm.busy).toBe(false);

        await wrapper.vm.submit();

        // Every submit fetches and solves its own challenge, so a retry
        // after a rejected (already-spent) solution automatically gets a
        // new one rather than needing an explicit reset step.
        expect(solveStampChallenge).toHaveBeenCalledTimes(2);
    });
});
