// SPDX-License-Identifier: 0BSD

/**
 * Browser-only LAN bind warning. Electron and Android bind locally and
 * never show this. Headless LAN binds keep running. The UI warns instead.
 */

export const LAN_BIND_NO_AUTH_BANNER_DISMISSED_KEY = "meshchatx_lan_bind_no_auth_banner_dismissed";

export function isLanBindNoAuthBannerDismissed() {
    try {
        return localStorage.getItem(LAN_BIND_NO_AUTH_BANNER_DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

export function dismissLanBindNoAuthBanner() {
    try {
        localStorage.setItem(LAN_BIND_NO_AUTH_BANNER_DISMISSED_KEY, "1");
    } catch {
        /* ignore storage failures */
    }
}

export function shouldShowLanBindNoAuthBanner({
    isElectron = false,
    isAndroid = false,
    authEnabled = false,
    // How the instance decides who may use it. On a shared instance this is
    // "accounts", and every API path is already closed to anyone without a
    // session, so the banner would be telling a signed-in person something
    // untrue about the instance they just signed in to. The single password
    // flag above stays false in that mode, so it cannot answer this on its
    // own.
    authMode = null,
    isLoopbackBind = true,
    routeName = "",
    dismissed = false,
    // A route that renders on its own (the auth page, and on a shared
    // instance the accounts sign-in page) carries no shell chrome, so this
    // banner about the shell's own bind settings has nothing to attach to.
    isStandaloneRoute = false,
} = {}) {
    if (dismissed || isLanBindNoAuthBannerDismissed()) {
        return false;
    }
    if (isElectron || isAndroid) {
        return false;
    }
    if (routeName === "auth" || isStandaloneRoute) {
        return false;
    }
    if (authEnabled || authMode === "accounts") {
        return false;
    }
    return isLoopbackBind === false;
}
