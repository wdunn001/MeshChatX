// SPDX-License-Identifier: 0BSD

// Oracle for the hosted multi-user entry gate: a server running in accounts
// mode is a shared resource, and the sign-in gate is what protects it, not
// a browsable state that happens to lack a session. Someone with no session
// on such an instance must get the sign-in page and nothing else. App.vue is
// a single-user desktop shell everywhere else, so the route the router
// lands a signed-out accounts-mode visitor on has to be excluded from that
// shell explicitly, both for what renders and for what the shell's own
// polling fetches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";
import { createVuetify } from "vuetify";
import App from "../../meshchatx/src/frontend/components/App.vue";
import GlobalState from "../../meshchatx/src/frontend/js/GlobalState.js";

const vuetify = createVuetify();
const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: {
        en: {
            app: { name: "MeshChatX", tagline: "All-in-one Reticulum client" },
        },
    },
});

const AUTHENTICATED_ONLY_PATHS = [
    "/api/v1/app/info",
    "/api/v1/config",
    "/api/v1/blocked-destinations",
    "/api/v1/telephone/status",
    "/api/v1/lxmf/propagation-node/status",
    "/api/v1/notifications",
    "/api/v1/rrc/hubs",
    "/api/v1/plugins",
];

describe("App.vue computeNeedShell", () => {
    beforeEach(() => {
        // Post-resolution decision logic is what these cases exercise; the
        // pre-resolution race itself has its own test below.
        GlobalState.authModeResolved = true;
    });

    afterEach(() => {
        GlobalState.authModeResolved = false;
        GlobalState.authMode = null;
        GlobalState.authEnabled = false;
        GlobalState.authenticated = false;
    });

    const needShellFor = (routeName) => App.methods.computeNeedShell.call({ $route: { name: routeName } });

    it("never starts the shell before the real auth status has been read once, in any mode", () => {
        GlobalState.authModeResolved = false;
        // Every field below is a value that would say "start" once resolved;
        // the point is that none of them matter until authModeResolved is
        // true, because this is exactly the state GlobalState is in for a
        // few milliseconds after every boot, accounts mode included, and
        // guessing "start" during that window is how a shared instance ends
        // up firing authenticated requests before anyone has signed in.
        GlobalState.authMode = null;
        GlobalState.authEnabled = false;
        GlobalState.authenticated = true;
        expect(needShellFor("messages")).toBe(false);
    });

    it("keeps the shell down on the accounts page with no session", () => {
        GlobalState.authMode = "accounts";
        GlobalState.authEnabled = false;
        GlobalState.authenticated = false;
        expect(needShellFor("accounts")).toBe(false);
    });

    it("keeps the shell down on setup-mode while unauthenticated", () => {
        GlobalState.authMode = "accounts";
        GlobalState.authenticated = false;
        expect(needShellFor("setup-mode")).toBe(false);
    });

    it("brings the shell up once an accounts-mode visitor is signed in and off the gate route", () => {
        GlobalState.authMode = "accounts";
        GlobalState.authenticated = true;
        expect(needShellFor("messages")).toBe(true);
    });

    it("does not start the shell while still sitting on the accounts route, even signed in", () => {
        GlobalState.authMode = "accounts";
        GlobalState.authenticated = true;
        expect(needShellFor("accounts")).toBe(false);
    });

    it("leaves single-password mode behaviour exactly as before", () => {
        GlobalState.authMode = "single";
        GlobalState.authEnabled = true;
        GlobalState.authenticated = false;
        expect(needShellFor("auth")).toBe(false);
        expect(needShellFor("messages")).toBe(false);
        GlobalState.authenticated = true;
        expect(needShellFor("messages")).toBe(true);
    });

    it("leaves the no-auth desktop path unchanged", () => {
        GlobalState.authMode = null;
        GlobalState.authEnabled = false;
        GlobalState.authenticated = false;
        expect(needShellFor("messages")).toBe(true);
    });
});

describe("App.vue sign-in gate on a multi-user instance with no session", () => {
    let router;
    let axiosMock;

    beforeEach(async () => {
        // In production this is populated by main.js's router guard (which
        // reads /api/v1/auth/status) before App.vue ever mounts. This test
        // mounts App.vue directly against a bare router with no such guard,
        // so it has to seed the same GlobalState the guard would have left
        // behind by the time the shell-gating watcher in mounted() runs.
        GlobalState.authMode = "accounts";
        GlobalState.authEnabled = false;
        GlobalState.authenticated = false;
        GlobalState.authSessionResolved = true;
        GlobalState.authModeResolved = true;
        GlobalState.networkReady = true;
        GlobalState.networkStarting = false;
        GlobalState.networkDegraded = false;

        axiosMock = {
            get: vi.fn((url) => {
                if (url === "/api/v1/auth/status") {
                    return Promise.resolve({
                        data: { auth_enabled: false, auth_mode: "accounts", authenticated: false },
                    });
                }
                return Promise.resolve({ data: {} });
            }),
            post: vi.fn(() => Promise.resolve({ data: {} })),
        };
        window.api = axiosMock;

        router = createRouter({
            history: createMemoryHistory(),
            routes: [
                {
                    path: "/accounts",
                    name: "accounts",
                    meta: { standalone: true },
                    component: { template: "<div data-testid='accounts-gate'>Sign in</div>" },
                },
                { path: "/", name: "messages", component: { template: "<div>Messages</div>" } },
            ],
        });
        await router.push("/accounts");
        await router.isReady();
    });

    afterEach(() => {
        delete window.api;
        GlobalState.authMode = null;
        GlobalState.authEnabled = false;
        GlobalState.authenticated = false;
        GlobalState.authModeResolved = false;
    });

    it("renders only the routed gate, with no shell chrome around it", async () => {
        const wrapper = mount(App, {
            global: {
                plugins: [router, vuetify, i18n],
                stubs: {
                    // The global test setup stubs RouterView down to an empty
                    // slot passthrough, which would hide the very routed
                    // content this test exists to check for. Un-stub it here
                    // so the real "accounts" route component renders.
                    RouterView: false,
                    MaterialDesignIcon: true,
                    LxmfUserIcon: true,
                    LanguageSelector: true,
                    CallOverlay: true,
                    CommandPalette: true,
                    IntegrityWarningModal: true,
                    PostInstallPromptHost: true,
                    VDialog: true,
                    VCard: true,
                    VCardText: true,
                    VCardActions: true,
                    VBtn: true,
                    VIcon: true,
                    VToolbar: true,
                    VToolbarTitle: true,
                    VSpacer: true,
                    VProgressCircular: true,
                    VCheckbox: true,
                    VDivider: true,
                },
            },
        });

        try {
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(wrapper.find("[data-testid='accounts-gate']").exists()).toBe(true);
            expect(wrapper.find("[data-testid='header-compose']").exists()).toBe(false);
            expect(wrapper.find("[data-testid='header-telephone']").exists()).toBe(false);
            expect(wrapper.find("[data-testid='header-command-palette']").exists()).toBe(false);
            expect(wrapper.find("[data-testid='sidebar-app-version']").exists()).toBe(false);

            const calledPaths = axiosMock.get.mock.calls.map(([url]) => url);
            for (const path of AUTHENTICATED_ONLY_PATHS) {
                expect(calledPaths).not.toContain(path);
            }
        } finally {
            // Left mounted, this component's watchers keep reacting to the
            // shared GlobalState singleton after the test ends (afterEach
            // resets it for the next test), spuriously starting the shell.
            // Unmount so the watchers stop with the test.
            wrapper.unmount();
        }
    });
});
