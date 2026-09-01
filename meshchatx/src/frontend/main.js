import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import vClickOutside from "./libs/clickOutside.js";
import DOMPurify from "dompurify";
import "./style.css";
import { injectMeshchatThemeVariables, vuetifyThemesFromTokens } from "./theme/designTokens.js";
import { registerUiI18n } from "./js/localeLoader.js";

injectMeshchatThemeVariables();

window.DOMPurify = DOMPurify;
import "@mdi/font/css/materialdesignicons.css";
import "./fonts/RobotoMonoNerdFont/font.css";
import { startCodec2ScriptsBackgroundLoad } from "./js/Codec2Loader";
import { createApiClient } from "./js/apiClient.js";
import { fetchCsrfToken } from "./js/csrfToken.js";
import { registerCoreContributions } from "./js/registries/registerCoreContributions.js";
import { installWsEventBridge } from "./js/registries/wsEventBridge.js";
import { pluginHost } from "./js/plugins/PluginHost.js";
import GlobalState from "./js/GlobalState.js";
import { recoveryLocationForNetworkError } from "./js/networkRecovery.js";
import ElectronUtils from "./js/ElectronUtils.js";
import {
    decideControllerChangeReload,
    isIgnorableServiceWorkerRegistrationError,
    serviceWorkerRegisterOptions,
    shouldRegisterServiceWorker,
    unregisterServiceWorkersIfPresent,
} from "./js/pwa/swClientRegister.js";
import "./js/HeapMonitor.js";

registerCoreContributions();
installWsEventBridge();

import App from "./components/App.vue";
import ChangelogModal from "./components/ChangelogModal.vue";
import TutorialModal from "./components/TutorialModal.vue";
import enMessages from "./locales/en.json";

const i18n = createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    messages: {
        en: enMessages,
    },
});
registerUiI18n(i18n);

// init vuetify
import { createVuetify } from "vuetify";
const vuetify = createVuetify({
    theme: {
        defaultTheme: "light",
        themes: vuetifyThemesFromTokens(),
    },
});

if (!window.location.hash || window.location.hash === "#") {
    history.replaceState(null, "", "#/messages");
}

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            name: "accounts",
            path: "/accounts",
            component: () => import("./components/auth/AccountsAuthPage.vue"),
            // standalone: App.vue renders this route on its own, with none of
            // the signed-in shell around it. A visitor with no session has
            // nothing to do with a nav rail, Compose, or a peer identity
            // widget, so the shell never mounts behind this page.
            meta: { isPage: true, standalone: true },
        },
        {
            name: "setup-mode",
            path: "/setup-mode",
            component: () => import("./components/auth/SetupModePage.vue"),
            meta: { isPage: true, standalone: true },
        },
        {
            name: "auth",
            path: "/auth",
            component: () => import("./components/auth/AuthPage.vue"),
            meta: { standalone: true },
        },
        {
            path: "/",
            redirect: "/messages",
        },
        {
            name: "about",
            path: "/about",
            component: () => import("./components/about/AboutPage.vue"),
        },
        {
            name: "interfaces",
            path: "/interfaces",
            component: () => import("./components/interfaces/InterfacesPage.vue"),
        },
        {
            name: "interfaces.add",
            path: "/interfaces/add",
            component: () => import("./components/interfaces/AddInterfacePage.vue"),
        },
        {
            name: "interfaces.edit",
            path: "/interfaces/edit",
            component: () => import("./components/interfaces/AddInterfacePage.vue"),
            props: {
                interface_name: String,
            },
        },
        {
            name: "messages",
            path: "/messages/:destinationHash?",
            props: true,
            meta: { stableKey: true },
            component: () => import("./components/messages/MessagesPage.vue"),
        },
        {
            name: "contacts",
            path: "/contacts",
            component: () => import("./components/contacts/ContactsPage.vue"),
        },
        {
            name: "map",
            path: "/map",
            meta: { keepAlive: true },
            component: () => import("./components/map/MapBrowser.vue"),
        },
        {
            name: "map-popout",
            path: "/popout/map",
            meta: { popoutType: "map", isPopout: true },
            component: () => import("./components/map/MapPage.vue"),
        },
        {
            name: "messages-popout",
            path: "/popout/messages/:destinationHash?",
            props: true,
            meta: { popoutType: "conversation", isPopout: true },
            component: () => import("./components/messages/MessagesPage.vue"),
        },
        {
            name: "network-visualiser",
            path: "/network-visualiser",
            component: () => import("./components/network-visualiser/NetworkVisualiserPage.vue"),
        },
        {
            name: "nomadnetwork",
            path: "/nomadnetwork/:destinationHash?",
            props: true,
            meta: { keepAlive: true },
            component: () => import("./components/nomadnetwork/NomadNetworkBrowser.vue"),
        },
        {
            name: "relay-chat",
            path: "/relay-chat",
            component: () => import("./components/relay/RelayChatPage.vue"),
        },
        {
            name: "relay-chat-popout",
            path: "/popout/relay-chat/:hubHash/:room?",
            props: true,
            meta: { popoutType: "relay", isPopout: true },
            component: () => import("./components/relay/RelayChatPage.vue"),
        },
        {
            name: "archives",
            path: "/archives",
            component: () => import("./components/archives/ArchivesPage.vue"),
        },
        {
            name: "nomadnetwork-popout",
            path: "/popout/nomadnetwork/:destinationHash?",
            props: true,
            meta: { popoutType: "nomad", isPopout: true },
            component: () => import("./components/nomadnetwork/NomadNetworkPage.vue"),
        },
        {
            name: "propagation-nodes",
            path: "/propagation-nodes",
            component: () => import("./components/propagation-nodes/PropagationNodesPage.vue"),
        },
        {
            name: "ping",
            path: "/ping",
            component: () => import("./components/ping/PingPage.vue"),
        },
        {
            name: "rncp",
            path: "/rncp",
            component: () => import("./components/rncp/RNCPPage.vue"),
        },
        {
            name: "rns-filesync",
            path: "/rns-filesync",
            component: () => import("./components/filesync/RnsFilesyncPage.vue"),
        },
        {
            name: "rnsh",
            path: "/rnsh",
            component: () => import("./components/tools/RNSHManagerPage.vue"),
        },
        {
            name: "rnx",
            path: "/rnx",
            component: () => import("./components/tools/RNXManagerPage.vue"),
        },
        {
            name: "rnstatus",
            path: "/rnstatus",
            component: () => import("./components/rnstatus/RNStatusPage.vue"),
        },
        {
            name: "rnpath",
            path: "/rnpath",
            component: () => import("./components/tools/RNPathPage.vue"),
        },
        {
            name: "rnpath-trace",
            path: "/rnpath-trace",
            component: () => import("./components/tools/RNPathTracePage.vue"),
        },
        {
            name: "rnprobe",
            path: "/rnprobe",
            component: () => import("./components/rnprobe/RNProbePage.vue"),
        },
        {
            name: "translator",
            path: "/translator",
            component: () => import("./components/translator/TranslatorPage.vue"),
        },
        {
            name: "bots",
            path: "/bots",
            component: () => import("./components/tools/BotsPage.vue"),
        },
        {
            name: "forwarder",
            path: "/forwarder",
            component: () => import("./components/forwarder/ForwarderPage.vue"),
        },
        {
            name: "micron-editor",
            path: "/micron-editor",
            component: () => import("./components/micron-editor/MicronEditorPage.vue"),
        },
        {
            name: "reticulum-config-editor",
            path: "/tools/reticulum-config-editor",
            component: () => import("./components/tools/ReticulumConfigEditorPage.vue"),
        },
        {
            name: "mesh-server",
            path: "/mesh-server",
            component: () => import("./components/page-nodes/PageNodesPage.vue"),
        },
        {
            name: "documentation",
            path: "/documentation",
            component: () => import("./components/docs/DocsPage.vue"),
        },
        {
            name: "profile.icon",
            path: "/profile/icon",
            component: () => import("./components/profile/ProfileIconPage.vue"),
        },
        {
            name: "settings",
            path: "/settings",
            component: () => import("./components/settings/SettingsPage.vue"),
        },
        {
            name: "accounts-admin",
            path: "/accounts-admin",
            component: () => import("./components/accounts/AccountsAdminPage.vue"),
        },
        {
            name: "identities",
            path: "/identities",
            component: () => import("./components/settings/IdentitiesPage.vue"),
        },
        {
            name: "blocked",
            path: "/blocked",
            component: () => import("./components/blocked/BlockedPage.vue"),
        },
        {
            name: "tools",
            path: "/tools",
            component: () => import("./components/tools/ToolsPage.vue"),
        },
        {
            name: "licenses",
            path: "/licenses",
            component: () => import("./components/licenses/LicensesPage.vue"),
        },
        {
            name: "paper-message",
            path: "/tools/paper-message",
            component: () => import("./components/tools/PaperMessagePage.vue"),
        },
        {
            name: "sieve-filters",
            path: "/tools/sieve-filters",
            component: () => import("./components/tools/SieveFiltersPage.vue"),
        },
        {
            name: "message-blocklist",
            path: "/tools/message-blocklist",
            component: () => import("./components/tools/MessageBlocklistPage.vue"),
        },
        {
            name: "rnode-flasher",
            path: "/tools/rnode-flasher",
            component: () => import("./components/tools/RNodeFlasherPage.vue"),
        },
        {
            name: "repository-server",
            path: "/tools/repository-server",
            component: () => import("./components/tools/RepositoryServerPage.vue"),
        },
        {
            name: "debug-logs",
            path: "/debug/logs",
            component: () => import("./components/debug/DebugLogsPage.vue"),
        },
        {
            name: "call",
            path: "/call",
            component: () => import("./components/call/CallPage.vue"),
        },
        {
            name: "call-popout",
            path: "/popout/call",
            meta: { isPopout: true },
            component: () => import("./components/call/CallPage.vue"),
        },
        {
            name: "plugin-mcx-bugs",
            path: "/plugins/com.meshchatx.mcx-bugs",
            component: () => import("./components/plugins/PluginPage.vue"),
            props: { pluginId: "com.meshchatx.mcx-bugs" },
        },
        {
            name: "changelog",
            path: "/changelog",
            component: ChangelogModal,
            meta: { isPage: true },
        },
        {
            name: "tutorial",
            path: "/tutorial",
            component: TutorialModal,
            meta: { isPage: true },
        },
    ],
});

window.api = createApiClient({
    onAuthError() {
        // An instance using accounts signs in on its own page. Sending someone
        // to the single password page instead put them in a loop: that page
        // redirects back here, and the next failed call sent them round again.
        const signInPage = GlobalState.authMode === "accounts" ? "accounts" : "auth";
        if (router.currentRoute.value.name !== signInPage) {
            GlobalState.authenticated = false;
            router.push("/" + signInPage);
        }
    },
});

import { waitForMeshReady, waitForNetworkReady } from "./js/networkStartupWait.js";
import {
    applyAuthStatusToGlobalState,
    fetchAuthStatus,
    fetchMultiuserStatus,
    resolveAuthNavigation,
} from "./js/authSessionSync.js";
import { isHostedInstance, isInstanceAdmin } from "./js/accountRole.js";

function setBootSplashLine(text) {
    const splash = typeof document !== "undefined" ? document.getElementById("meshchatx-boot-splash") : null;
    const line = splash?.querySelector("[data-boot-line]");
    if (line && text) {
        line.textContent = text;
    }
}

function markBootSplashError() {
    const splash = typeof document !== "undefined" ? document.getElementById("meshchatx-boot-splash") : null;
    if (splash) {
        splash.setAttribute("data-state", "error");
    }
}

const networkReady = await waitForNetworkReady({
    onLine: setBootSplashLine,
    onErrorState: markBootSplashError,
    onDegraded: (error) => {
        GlobalState.networkDegraded = true;
        GlobalState.networkDegradedError = error || "RNS unavailable";
        GlobalState.networkStarting = false;
        GlobalState.networkReady = false;
    },
});
if (networkReady) {
    if (networkReady === "degraded") {
        GlobalState.networkDegraded = true;
        GlobalState.networkStarting = false;
        GlobalState.networkReady = false;
    } else if (networkReady === "ui") {
        GlobalState.networkStarting = true;
        GlobalState.networkReady = false;
    } else {
        GlobalState.networkStarting = false;
        GlobalState.networkReady = true;
    }
    try {
        const statusResponse = await window.api.get("/api/v1/status");
        GlobalState.demoMode = !!statusResponse.data?.demo_mode;
        if (typeof statusResponse.data?.is_loopback_bind === "boolean") {
            GlobalState.isLoopbackBind = statusResponse.data.is_loopback_bind;
        }
    } catch {
        // status optional during early boot
    }
    try {
        await fetchCsrfToken(window.api);
    } catch {
        // CSRF token will be retried on the next mutating request if needed.
    }

    // Started here, not awaited here. mount() below must not wait on this, or
    // boot timing changes for every build including desktop. loadPluginsIfEnabled
    // is the one caller that needs the real answer rather than the GlobalState
    // defaults, because it runs synchronously out of bootstrap() before the
    // router guard below has had a chance to resolve the same question.
    const initialAuthStatusPromise = fetchAuthStatus(window.api)
        .then((status) => {
            applyAuthStatusToGlobalState(status);
            return status;
        })
        .catch(() => null);

    router.beforeEach(async (to, _from, next) => {
        const decision = await resolveAuthNavigation(to, window.api);
        if (decision.allow) {
            next();
            return;
        }
        next(decision.redirect);
    });

    function registerMeshchatServiceWorker() {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
            return;
        }
        if (
            !shouldRegisterServiceWorker({
                isDev: import.meta.env.DEV,
                isElectron: ElectronUtils.isElectron(),
            })
        ) {
            void unregisterServiceWorkersIfPresent(navigator.serviceWorker);
            return;
        }
        let refreshing = false;
        const hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            const decision = decideControllerChangeReload({ hadController, refreshing });
            refreshing = decision.nextRefreshing;
            if (decision.shouldReload) {
                window.location.reload();
            }
        });
        navigator.serviceWorker
            .register("/service-worker.js", serviceWorkerRegisterOptions())
            .then((registration) => {
                const requestUpdate = () => {
                    try {
                        void registration.update();
                    } catch {
                        // ignore update failures
                    }
                };
                document.addEventListener("visibilitychange", () => {
                    if (document.visibilityState === "visible") {
                        requestUpdate();
                    }
                });
                requestUpdate();
            })
            .catch((error) => {
                if (isIgnorableServiceWorkerRegistrationError(error)) {
                    return;
                }
                console.debug("Service worker registration failed:", error);
            });
    }

    function removeBootSplash(splash) {
        if (!splash || !splash.isConnected) {
            return;
        }
        splash.setAttribute("aria-busy", "false");
        splash.style.transition = "opacity 140ms ease";
        splash.style.opacity = "0";
        window.setTimeout(() => {
            if (splash.isConnected) {
                splash.remove();
            }
        }, 160);
    }

    function preloadCriticalRouteChunks() {
        void import("./components/messages/MessagesPage.vue");
        void import("./components/contacts/ContactsPage.vue");
        void import("./components/interfaces/InterfacesPage.vue");
    }

    function bootstrap() {
        registerMeshchatServiceWorker();
        const splash = typeof document !== "undefined" ? document.getElementById("meshchatx-boot-splash") : null;
        try {
            createApp(App).use(router).use(vuetify).use(i18n).use(vClickOutside).mount("#app");
        } catch (e) {
            console.error("MeshChatX bootstrap failed:", e);
            if (splash) {
                splash.setAttribute("data-state", "error");
                const line = splash.querySelector("[data-boot-line]");
                if (line) {
                    line.textContent = "Failed to start. Try closing and reopening the app.";
                }
            }
            return;
        }
        // Keep splash until the first painted frame so WebView does not flash white.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                removeBootSplash(splash);
            });
        });
        preloadCriticalRouteChunks();
        if (GlobalState.networkReady) {
            void startCodec2ScriptsBackgroundLoad();
            void loadPluginsIfEnabled();
        } else if (GlobalState.networkStarting) {
            void waitForMeshReady({
                onLine: () => {},
                onDegraded: (error) => {
                    GlobalState.networkDegraded = true;
                    GlobalState.networkDegradedError = error || "RNS unavailable";
                    GlobalState.networkStarting = false;
                    GlobalState.networkReady = false;
                },
            }).then((meshState) => {
                if (meshState === "ready") {
                    GlobalState.networkStarting = false;
                    GlobalState.networkReady = true;
                    GlobalState.networkDegraded = false;
                    GlobalState.networkDegradedError = null;
                    void startCodec2ScriptsBackgroundLoad();
                    void loadPluginsIfEnabled();
                } else if (meshState === "degraded") {
                    GlobalState.networkStarting = false;
                    GlobalState.networkReady = false;
                } else {
                    GlobalState.networkStarting = false;
                    GlobalState.networkReady = false;
                    GlobalState.networkDegraded = true;
                    GlobalState.networkDegradedError = GlobalState.networkDegradedError || "RNS startup timed out";
                }
            });
        }
        if (GlobalState.networkDegraded) {
            const recoveryLocation = recoveryLocationForNetworkError(GlobalState.networkDegradedError);
            if (recoveryLocation) {
                try {
                    router.replace(recoveryLocation);
                } catch {
                    // Route may not exist yet during early boot, but the banner still guides the user.
                }
            }
        }
    }

    async function loadPluginsIfEnabled() {
        await initialAuthStatusPromise;
        // A shared instance's plugin list is admin state, not something a
        // visitor who has not signed in yet has any use for. GlobalState.authEnabled
        // is the single password flag and stays false on an accounts instance,
        // so it cannot be the thing that gates this below.
        if (GlobalState.authMode === "accounts" && !GlobalState.authenticated) {
            return;
        }
        if (!(GlobalState.authenticated || !GlobalState.authEnabled)) {
            return;
        }
        // The plugin list is admin state on a shared instance, so an ordinary
        // account is refused it. Read the role first when it is not known yet:
        // this runs at boot and can beat the router guard that normally loads
        // it, and guessing here would either skip plugins for the operator or
        // spend a 403 on everybody else.
        if (isHostedInstance(GlobalState)) {
            if (!GlobalState.accountRole) {
                await fetchMultiuserStatus(window.api);
            }
            if (!isInstanceAdmin(GlobalState)) {
                return;
            }
        }
        try {
            const response = await window.api.get("/api/v1/plugins");
            GlobalState.pluginsEnabled = response.data?.plugins_enabled !== false;
            if (!GlobalState.pluginsEnabled) {
                return;
            }
            await pluginHost.loadEnabledPlugins(window.api, i18n.global.locale.value);
        } catch (error) {
            console.debug("Plugin host bootstrap failed:", error);
        }
    }

    bootstrap();
}
