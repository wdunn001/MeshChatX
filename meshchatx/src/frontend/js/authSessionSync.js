import GlobalState from "./GlobalState.js";
import { routeAllowed } from "./accountRole.js";

/** Max wait for auth status during navigation guards and reconnect resync. */
export const AUTH_STATUS_TIMEOUT_MS = 10000;

/**
 * Copy auth status fields from the API into GlobalState.
 * @param {Record<string, unknown> | null | undefined} status
 */
export function applyAuthStatusToGlobalState(status) {
    if (!status || typeof status !== "object") {
        return;
    }
    GlobalState.authEnabled = !!status.auth_enabled;
    // Where an expired session should send someone back to. An instance using
    // accounts has no single password page to offer them.
    GlobalState.authMode = status.auth_mode || null;
    GlobalState.authenticated = !!status.authenticated;
    GlobalState.demoMode = !!status.demo_mode;
    if (typeof status.is_loopback_bind === "boolean") {
        GlobalState.isLoopbackBind = status.is_loopback_bind;
    }
    GlobalState.authSessionResolved = true;
    GlobalState.authModeResolved = true;
}

/**
 * Copy the signed-in account from the multi-user status into GlobalState.
 *
 * The role is what the UI gates on, so that an ordinary person on a shared
 * instance is not offered the pages their account cannot reach. The backend
 * refuses those calls regardless, in
 * meshchatx/src/backend/multiuser/permissions.py.
 *
 * @param {Record<string, unknown> | null | undefined} status
 */
export function applyMultiuserStatusToGlobalState(status) {
    if (!status || typeof status !== "object") {
        return;
    }
    const account = status.account && typeof status.account === "object" ? status.account : null;
    GlobalState.accountRole = account?.role || null;
    GlobalState.accountUsername = account?.username || null;
    GlobalState.accountIdentityHash = account?.identity_hash || null;
    GlobalState.accountRegistrationOpen = status.registration_open !== false;
}

/**
 * Read the signed-in account, on an instance running in accounts mode.
 *
 * A failure leaves the account fields alone rather than clearing them, because
 * a dropped request is not evidence that somebody's role has changed.
 *
 * @param {import("./apiClient.js").createApiClient} api
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchMultiuserStatus(api) {
    try {
        const response = await api.get("/api/v1/multiuser/status");
        applyMultiuserStatusToGlobalState(response?.data);
        return response?.data ?? null;
    } catch {
        return null;
    }
}

/**
 * @param {import("./apiClient.js").createApiClient} api
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchAuthStatus(api, options = {}) {
    const timeoutMs = options.timeoutMs ?? AUTH_STATUS_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await api.get("/api/v1/auth/status", { signal: controller.signal });
        return response.data ?? {};
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Decide where a navigation should land after reading auth status.
 * @param {{ name?: string | null }} to
 * @param {Record<string, unknown>} status
 * @returns {{ allow: true } | { redirect: string }}
 */
export function authNavigationTargetForStatus(to, status) {
    // An instance serving several people signs in by account, so an
    // unauthenticated visitor goes to the accounts page rather than to the
    // single password page, which would ask for a password nobody has.
    if (status.auth_mode === "accounts") {
        if (status.authenticated) {
            return to.name === "accounts" ? { redirect: "/" } : { allow: true };
        }
        return to.name === "accounts" ? { allow: true } : { redirect: "/accounts" };
    }
    // First run has not chosen how this instance is used yet.
    if (!status.auth_mode && Array.isArray(status.auth_modes_available)) {
        if (status.auth_modes_available.includes("accounts")) {
            return to.name === "setup-mode" ? { allow: true } : { redirect: "/setup-mode" };
        }
    }
    if (!status.auth_enabled) {
        return { allow: true };
    }
    if (status.authenticated) {
        if (to.name === "auth") {
            return { redirect: "/" };
        }
        return { allow: true };
    }
    if (to.name === "auth") {
        return { allow: true };
    }
    return { redirect: "/auth" };
}

/**
 * Auth guard oracle used by the router beforeEach hook.
 * @param {{ name?: string | null }} to
 * @param {import("./apiClient.js").createApiClient} api
 * @returns {Promise<{ allow: true } | { redirect: string }>}
 */
export async function resolveAuthNavigation(to, api) {
    try {
        const status = await fetchAuthStatus(api);
        applyAuthStatusToGlobalState(status);
        const target = authNavigationTargetForStatus(to, status);
        if (target.allow !== true) {
            return target;
        }
        // On a shared instance the role decides which pages exist for this
        // person. It is read here, before the page mounts, so an ordinary
        // account never opens a page whose every request the backend will
        // refuse. Off a shared instance nothing is fetched and nothing is
        // gated.
        if (status.auth_mode === "accounts" && status.authenticated) {
            if (!GlobalState.accountRole) {
                await fetchMultiuserStatus(api);
            }
            if (!routeAllowed(to.name, GlobalState)) {
                return { redirect: "/messages" };
            }
        }
        return target;
    } catch (e) {
        GlobalState.authSessionResolved = true;
        if (e.response?.status === 401 || e.response?.status === 403) {
            GlobalState.authenticated = false;
            return { redirect: "/auth" };
        }
        return { allow: true };
    }
}
