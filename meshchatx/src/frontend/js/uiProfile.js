// SPDX-License-Identifier: 0BSD

/**
 * The browser-local state a person carries, and how it follows them.
 *
 * localStorage belongs to the browser, not to the person using it. On a
 * desktop install those are the same thing. On a shared onboarding terminal
 * they are not: one person's collapsed sidebar, dismissed prompt, translate
 * language or unsent draft sits there for whoever signs in next.
 *
 * Every key below was audited. Drafts are the only store that already
 * namespaces by identity, so the next person is not shown them. The rest are
 * genuinely shared, which is the case where somebody's preference is imposed
 * on the next person rather than merely left lying around.
 *
 * The answer is the same for both. On a hosted instance the browser is cleared
 * on the way in and on the way out, and the values live per identity on the
 * server between sessions. Nothing here changes a desktop install, where the
 * browser is the person's own and clearing it would only lose their settings.
 *
 * This is a holding position until the PWA. There the identity lives on the
 * person's own device, the browser is theirs again, and none of this applies.
 */

/**
 * Keys the app writes to localStorage, with what each holds.
 *
 * Anything added to localStorage elsewhere in the app belongs here too, or it
 * silently becomes the next person's problem.
 */
export const BROWSER_STATE_KEYS = [
    // Unsent message text. Already bucketed by identity hash, so it is not
    // shown to anyone else, but the words still sit in a shared browser.
    "meshchat.drafts",
    // Which prompts and warnings somebody has dismissed. Shared, so one
    // person's dismissal silences it for the next.
    "meshchatx.post_install_prompts_seen",
    "integrity_warning_dismissed",
    "meshchatx_lan_bind_no_auth_banner_dismissed",
    "map_onboarding_seen",
    "meshchatx_exposure_ack_firewall",
    "meshchatx_exposure_ack_vpn",
    // Layout and view state.
    "meshchatx_folders_expanded",
    "relayChatSidebarCollapsed",
    "meshchat.nomadnet.favourites.layout",
    // Display preferences with no per identity key behind them.
    "meshchatx_message_timestamp_grouping_enabled",
    "meshchatx_detailed_outbound_send_status",
    "meshchatx_outbound_transfer_progress_enabled",
    "meshchatx.visualiser.renderer",
    "meshchatx.visualiser.viewMode",
    "meshchatx.visualiser.maxHops",
    "meshchatx.map.offlineMode",
    "meshchatx.batterySaver",
    // Working state on individual pages.
    "meshchatx.translateTargetLang",
    "meshchatx.composeTranslateTargetLang",
    "meshchatx.interfaces.statusFilter",
    "meshchatx.interfaces.discoveredStatusFilter",
    "meshchatx.rncp.listenForm.v1",
    // The theme is a paint cache in front of the per identity config value.
    // It is carried anyway so a person does not get one frame of the previous
    // person's theme before their own config arrives.
    "meshchatx_ui_theme",
];

/** Read every known key that is currently set. Never throws. */
export function readBrowserState() {
    const profile = {};
    for (const key of BROWSER_STATE_KEYS) {
        try {
            const value = localStorage.getItem(key);
            if (value !== null) {
                profile[key] = value;
            }
        } catch {
            // A browser refusing storage is not a reason to fail a sign out.
        }
    }
    return profile;
}

/** Remove every known key. Never throws. */
export function clearBrowserState() {
    for (const key of BROWSER_STATE_KEYS) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Same.
        }
    }
}

/**
 * Write a stored profile back into localStorage.
 *
 * Only keys this build knows about are restored, so a profile written by a
 * newer version cannot inject arbitrary storage into an older one.
 */
export function applyBrowserState(profile) {
    if (!profile || typeof profile !== "object") {
        return;
    }
    const known = new Set(BROWSER_STATE_KEYS);
    for (const [key, value] of Object.entries(profile)) {
        if (!known.has(key) || typeof value !== "string") {
            continue;
        }
        try {
            localStorage.setItem(key, value);
        } catch {
            // Quota or private mode. The person gets defaults.
        }
    }
}

/**
 * Fetch this identity's profile and apply it. Returns false when nothing was
 * applied, so a caller can tell a fresh browser from a failed read.
 *
 * @param {import("./apiClient.js").createApiClient} api
 */
export async function loadUiProfile(api) {
    try {
        const response = await api.get("/api/v1/app/ui-profile");
        const profile = response?.data?.profile;
        if (!profile || typeof profile !== "object") {
            return false;
        }
        applyBrowserState(profile);
        return true;
    } catch {
        // A profile that cannot be read leaves the person on defaults, which
        // is the same place a first sign in puts them.
        return false;
    }
}

/**
 * Store the browser's current state against this identity.
 *
 * @param {import("./apiClient.js").createApiClient} api
 */
export async function saveUiProfile(api) {
    try {
        await api.put("/api/v1/app/ui-profile", { profile: readBrowserState() });
        return true;
    } catch {
        return false;
    }
}
