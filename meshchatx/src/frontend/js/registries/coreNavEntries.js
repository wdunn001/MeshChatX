// SPDX-License-Identifier: 0BSD

/** @typedef {'unreadConversationsCount' | 'relayChatUnreadCount' | 'missedCallsCount'} NavBadgeSource */

/** @typedef {'primary' | 'more'} NavTier */

/** @typedef {'communicate' | 'explore' | 'network' | 'app'} NavGroup */

/**
 * @typedef {Object} NavEntry
 * @property {string} id
 * @property {{ name: string }} route
 * @property {string} icon
 * @property {string} labelKey
 * @property {string} [label]
 * @property {{ source: NavBadgeSource, pill?: boolean, cap?: number } | null} [badge]
 * @property {'rrcEnabled' | 'hostedInstance' | null} [visibleWhen]
 * @property {'user' | 'contributor' | 'admin'} [minRole]
 * @property {string | null} [pluginId]
 * @property {NavTier} [navTier]
 * @property {NavGroup} [group]
 */

/** @type {NavEntry[]} */
export const CORE_NAV_ENTRIES = [
    {
        id: "messages",
        route: { name: "messages" },
        icon: "message-text",
        labelKey: "app.messages",
        badge: { source: "unreadConversationsCount", pill: true, cap: 99 },
        navTier: "primary",
        group: "communicate",
    },
    {
        id: "call",
        route: { name: "call" },
        icon: "phone",
        labelKey: "app.audio_calls",
        badge: { source: "missedCallsCount", pill: true, cap: 99 },
        navTier: "primary",
        group: "communicate",
    },
    {
        id: "contacts",
        route: { name: "contacts" },
        icon: "account-multiple",
        labelKey: "app.contacts",
        navTier: "primary",
        group: "communicate",
    },
    {
        id: "relay-chat",
        route: { name: "relay-chat" },
        icon: "forum",
        labelKey: "app.relay_chat",
        badge: { source: "relayChatUnreadCount", pill: true, cap: 1000 },
        visibleWhen: "rrcEnabled",
        navTier: "primary",
        group: "communicate",
    },
    {
        id: "nomadnetwork",
        route: { name: "nomadnetwork" },
        icon: "earth",
        labelKey: "app.nomad_network",
        navTier: "primary",
        group: "explore",
    },
    {
        id: "map",
        route: { name: "map" },
        icon: "map",
        labelKey: "app.map",
        navTier: "primary",
        group: "explore",
    },
    {
        id: "network-visualiser",
        route: { name: "network-visualiser" },
        icon: "hub",
        labelKey: "app.network_visualiser",
        navTier: "primary",
        group: "explore",
    },
    {
        id: "interfaces",
        route: { name: "interfaces" },
        icon: "router",
        labelKey: "app.interfaces",
        // The interface list is the instance's own transport. On a shared
        // instance one person editing it changes the network for everyone
        // signed in, so it belongs to whoever runs the machine.
        minRole: "admin",
        navTier: "primary",
        group: "app",
    },
    {
        id: "tools",
        route: { name: "tools" },
        icon: "wrench",
        labelKey: "app.tools",
        navTier: "primary",
        group: "app",
    },
    {
        id: "settings",
        route: { name: "settings" },
        icon: "cog",
        labelKey: "app.settings",
        navTier: "primary",
        group: "app",
    },
    {
        id: "archives",
        route: { name: "archives" },
        icon: "archive",
        labelKey: "app.archives",
        navTier: "more",
        group: "explore",
    },
    {
        id: "blocked",
        route: { name: "blocked" },
        icon: "gavel",
        labelKey: "banishment.title",
        // Banishment blackholes an identity on the shared Reticulum instance.
        // An ordinary account mutes somebody through the message blocklist in
        // Settings, which reaches nobody else.
        minRole: "contributor",
        navTier: "more",
        group: "network",
    },
    {
        id: "identities",
        route: { name: "identities" },
        icon: "badge-account",
        labelKey: "app.identities",
        // Every identity on the machine, including other people's. Switching
        // to one of them would also break the account this session is bound
        // to.
        minRole: "admin",
        navTier: "more",
        group: "app",
    },
    {
        id: "about",
        route: { name: "about" },
        icon: "information",
        labelKey: "app.about",
        navTier: "more",
        group: "app",
    },
    {
        id: "accounts-admin",
        route: { name: "accounts-admin" },
        icon: "account-group",
        labelKey: "accounts_admin.title",
        // Only ever reachable on an instance running in accounts mode, and
        // only by the person who runs it.
        visibleWhen: "hostedInstance",
        minRole: "admin",
        navTier: "more",
        group: "app",
    },
];
