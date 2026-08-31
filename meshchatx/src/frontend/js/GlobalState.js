import { reactive } from "vue";

// global state
const globalState = reactive({
    authSessionResolved: true,
    authEnabled: false,
    // How this instance decides who may use it: null (not yet resolved, or a
    // single desktop build that never asks), "open", "single", or "accounts".
    // Set from /api/v1/auth/status once boot resolves it.
    authMode: null,
    // True once the real /api/v1/auth/status answer has been read at least
    // once. Starts false, unlike authSessionResolved above, specifically so
    // App.vue's shell-start watcher has a field that reliably flips from
    // false to true and therefore always fires, rather than one that may
    // already equal its post-resolve value and never trigger a change.
    authModeResolved: false,
    isLoopbackBind: true,
    authenticated: false,
    pluginsEnabled: true,
    detailedOutboundSendStatus: false,
    outboundTransferProgressEnabled: true,
    messageTimestampGroupingEnabled: true,
    unreadConversationsCount: 0,
    relayChatUnreadCount: 0,
    missedCallsCount: 0,
    activeCallTab: "phone",
    blockedDestinations: [],
    modifiedInterfaceNames: new Set(),
    hasPendingInterfaceChanges: false,
    networkDegraded: false,
    networkDegradedError: null,
    networkStarting: false,
    networkReady: true,
    demoMode: false,
    config: {
        show_unknown_contact_banner: true,
        banished_effect_enabled: true,
        banished_text: "BANISHED",
        banished_color: "#dc2626",
        message_outbound_bubble_color: "#4f46e5",
        message_inbound_bubble_color: null,
        message_failed_bubble_color: "#ef4444",
        message_waiting_bubble_color: "#e5e7eb",
        nomad_render_markdown_enabled: true,
        nomad_render_html_enabled: true,
        nomad_render_plaintext_enabled: true,
        nomad_micron_wasm_enabled: true,
        nomad_micron_default_engine: "js",
        nomad_default_page_path: "/page/index.mu",
        ui_transparency: 0,
        ui_glass_enabled: true,
        message_list_virtualization: true,
        warn_on_stranger_links: true,
        messages_sidebar_position: "left",
        messages_multi_pane_enabled: true,
        nomad_tabs_enabled: true,
        rrc_enabled: true,
        rrc_unread_badges_enabled: true,
    },
});

export function mergeGlobalConfig(next) {
    if (!next || typeof next !== "object") {
        return;
    }
    const prev = globalState.config && typeof globalState.config === "object" ? globalState.config : {};
    globalState.config = { ...prev, ...next };
}

export default globalState;
