import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AuthPage from "../../meshchatx/src/frontend/components/auth/AuthPage.vue";
import { solveStampChallenge } from "../../meshchatx/src/frontend/js/stampChallenge.js";

// The real solveStampChallenge fetches a challenge over the network and
// solves it in wasm, neither of which is available (or wanted) in jsdom.
// Mocking the whole module keeps these tests at the level of this
// component's own gating and error handling, not the solver itself (that
// belongs to StampSolver.test.js / the backend stamp_auth oracle tests).
vi.mock("../../meshchatx/src/frontend/js/stampChallenge.js", () => ({
    solveStampChallenge: vi.fn(),
}));

const authI18n = {
    "auth.setup_title": "Initial Setup",
    "auth.login_title": "Authentication Required",
    "auth.setup_subtitle": "Set an admin password to secure your MeshChatX instance",
    "auth.login_subtitle": "Please enter your password to continue",
    "auth.password_label": "Password",
    "auth.password_placeholder": "Enter password",
    "auth.password_min_length": "Password must be at least 8 characters long",
    "auth.confirm_password_label": "Confirm Password",
    "auth.confirm_password_placeholder": "Confirm password",
    "auth.processing": "Processing...",
    "auth.set_password": "Set Password",
    "auth.login": "Login",
    "auth.passwords_mismatch": "Passwords do not match",
    "auth.stamp_required": "Complete the proof of work challenge first",
    "auth.stamp_solving": "Solving proof of work...",
    "auth.stamp_progress": "{attempts} attempts, {seconds}s so far",
    "auth.stamp_failed": "That proof of work failed. Try again.",
    "auth.stamp_unavailable": "Proof of work could not run in this browser. Reload the page and try again.",
    "auth.status_check_failed": "Failed to check authentication status",
    "auth.failed": "Authentication failed",
    "app.demo_mode_active": "Demo mode active",
};

function translate(key, params) {
    let text = authI18n[key] || key;
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

describe("AuthPage.vue", () => {
    let axiosMock;
    let routerMock;

    beforeEach(() => {
        axiosMock = {
            get: vi.fn().mockResolvedValue({
                data: {
                    auth_enabled: true,
                    authenticated: false,
                    password_set: true,
                },
            }),
            post: vi.fn().mockResolvedValue({ data: { success: true } }),
        };
        window.api = axiosMock;

        routerMock = {
            push: vi.fn(),
        };

        Object.defineProperty(window, "location", {
            value: {
                reload: vi.fn(),
            },
            writable: true,
        });

        solveStampChallenge.mockReset();
    });

    afterEach(() => {
        delete window.api;
        vi.clearAllMocks();
    });

    const mountAuthPage = () => {
        return mount(AuthPage, {
            global: {
                mocks: {
                    $router: routerMock,
                    $t: translate,
                },
            },
        });
    };

    it("renders login form when password is set", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: true,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Authentication Required");
        expect(wrapper.text()).toContain("Login");
        expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    });

    it("renders setup form when password is not set", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: false,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(wrapper.vm.isSetup).toBe(true);
        expect(wrapper.text()).toContain("Initial Setup");
        expect(wrapper.text()).toContain("Set Password");
        expect(wrapper.findAll('input[type="password"]').length).toBe(2);
    });

    it("redirects to home when auth is disabled", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: false,
                authenticated: false,
                password_set: false,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        expect(routerMock.push).toHaveBeenCalledWith("/");
    });

    it("redirects to home when already authenticated", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: true,
                password_set: true,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        expect(routerMock.push).toHaveBeenCalledWith("/");
    });

    it("validates password length in setup mode", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: false,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 100));

        wrapper.vm.password = "short";
        wrapper.vm.confirmPassword = "short";
        await wrapper.vm.$nextTick();
        await wrapper.vm.handleSubmit();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.error).toContain("at least 8 characters");
        expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("validates password match in setup mode", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: false,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 100));

        wrapper.vm.password = "password123";
        wrapper.vm.confirmPassword = "password456";
        await wrapper.vm.$nextTick();
        await wrapper.vm.handleSubmit();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.error).toContain("do not match");
        expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("submits setup form with valid password", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: false,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 100));

        wrapper.vm.password = "password123";
        wrapper.vm.confirmPassword = "password123";
        await wrapper.vm.$nextTick();
        await wrapper.vm.handleSubmit();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/auth/setup", {
            password: "password123",
        });
    });

    it("submits login form with password", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: true,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        wrapper.vm.password = "password123";
        await wrapper.vm.handleSubmit();
        await wrapper.vm.$nextTick();

        expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/auth/login", {
            password: "password123",
        });
        expect(solveStampChallenge).not.toHaveBeenCalled();
    });

    it("reloads page after successful login", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: true,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        wrapper.vm.password = "password123";
        await wrapper.vm.handleSubmit();
        await wrapper.vm.$nextTick();

        expect(window.location.reload).toHaveBeenCalled();
    });

    it("displays error message on login failure", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: true,
            },
        });
        axiosMock.post.mockRejectedValueOnce({
            response: {
                data: {
                    error: "Invalid password",
                },
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        wrapper.vm.password = "wrongpassword";
        await wrapper.vm.handleSubmit();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.error).toBe("Invalid password");
        expect(wrapper.vm.isLoading).toBe(false);
    });

    it("displays error message on setup failure", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: false,
            },
        });
        axiosMock.post.mockRejectedValueOnce({
            response: {
                data: {
                    error: "Setup failed",
                },
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        wrapper.vm.password = "password123";
        wrapper.vm.confirmPassword = "password123";
        await wrapper.vm.handleSubmit();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.error).toBe("Setup failed");
        expect(wrapper.vm.isLoading).toBe(false);
    });

    it("disables submit button when loading", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: true,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        wrapper.vm.isLoading = true;
        await wrapper.vm.$nextTick();

        const submitButton = wrapper.find('button[type="submit"]');
        expect(submitButton.attributes("disabled")).toBeDefined();
    });

    it("disables submit button when passwords do not match in setup mode", async () => {
        axiosMock.get.mockResolvedValueOnce({
            data: {
                auth_enabled: true,
                authenticated: false,
                password_set: false,
            },
        });

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 100));

        wrapper.vm.password = "password123";
        wrapper.vm.confirmPassword = "password456";
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        const submitButton = wrapper.find('button[type="submit"]');
        const disabledAttr = submitButton.attributes("disabled");
        const disabledProp = submitButton.element.disabled;
        expect(disabledAttr !== undefined || disabledProp === true).toBe(true);
    });

    it("handles network errors gracefully", async () => {
        axiosMock.get.mockRejectedValueOnce(new Error("Network error"));

        const wrapper = mountAuthPage();
        await wrapper.vm.$nextTick();
        await wrapper.vm.checkAuthStatus();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.error).toContain("Failed to check");
    });

    describe("with stamp auth enabled", () => {
        beforeEach(() => {
            axiosMock.get.mockResolvedValue({
                data: {
                    auth_enabled: true,
                    authenticated: false,
                    password_set: true,
                    stamp_auth_enabled: true,
                },
            });
        });

        it("solves a stamp and attaches it to the login request", async () => {
            solveStampChallenge.mockResolvedValue(SOLVED_PROOF);

            const wrapper = mountAuthPage();
            await wrapper.vm.$nextTick();
            await wrapper.vm.checkAuthStatus();
            await wrapper.vm.$nextTick();

            expect(wrapper.vm.stampAuthEnabled).toBe(true);

            wrapper.vm.password = "password123";
            await wrapper.vm.handleSubmit();
            await wrapper.vm.$nextTick();

            expect(solveStampChallenge).toHaveBeenCalledWith(
                "/api/v1/auth/stamp/challenge",
                expect.any(Function),
            );
            expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/auth/login", {
                password: "password123",
                stamp_proof: SOLVED_PROOF,
            });
        });

        it("shows live progress while solving", async () => {
            let reportProgress;
            let releaseSolve;
            solveStampChallenge.mockImplementation((_url, onProgress) => {
                reportProgress = onProgress;
                return new Promise((resolve) => {
                    releaseSolve = () => resolve(SOLVED_PROOF);
                });
            });

            const wrapper = mountAuthPage();
            await wrapper.vm.$nextTick();
            await wrapper.vm.checkAuthStatus();
            await wrapper.vm.$nextTick();

            wrapper.vm.password = "password123";
            const submitPromise = wrapper.vm.handleSubmit();
            await wrapper.vm.$nextTick();

            expect(wrapper.vm.solving).toBe(true);
            reportProgress({ attempts: 500, elapsedMs: 900 });
            await wrapper.vm.$nextTick();

            expect(wrapper.text()).toContain("Solving proof of work");
            expect(wrapper.text()).toContain("500 attempts, 0.9s so far");

            releaseSolve();
            await submitPromise;
            expect(wrapper.vm.solving).toBe(false);
        });

        it("blocks submission and surfaces a readable error when the wasm solver is unavailable", async () => {
            solveStampChallenge.mockRejectedValue(new Error("stamp_wasm_unavailable"));

            const wrapper = mountAuthPage();
            await wrapper.vm.$nextTick();
            await wrapper.vm.checkAuthStatus();
            await wrapper.vm.$nextTick();

            wrapper.vm.password = "password123";
            await wrapper.vm.handleSubmit();
            await wrapper.vm.$nextTick();

            expect(axiosMock.post).not.toHaveBeenCalled();
            expect(wrapper.vm.error).toBe(
                "Proof of work could not run in this browser. Reload the page and try again.",
            );
            expect(wrapper.vm.isLoading).toBe(false);
        });
    });
});
