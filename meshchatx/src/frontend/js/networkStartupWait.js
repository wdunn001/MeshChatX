// SPDX-License-Identifier: 0BSD AND MIT

export const STARTUP_STAGE_LABELS = {
    http: "Getting things ready…",
    starting: "Getting RNS ready…",
    rns: "Starting RNS…",
    identity: "Almost there…",
    ready: "Ready",
    failed: "Startup failed",
};

/**
 * Interpret a /api/v1/status JSON body for boot gating.
 * Only own properties are trusted so prototype pollution cannot spoof readiness.
 *
 * A body with no "status" key at all, such as a session error like
 * {"error": "Sign in to use this instance"}, is never treated as
 * "starting". A body of that kind proves the server answered the request,
 * and answering is all boot gating needs: the shell should mount and let
 * the sign-in page take it from there rather than keep polling toward a
 * timeout. Only an explicit "starting" status keeps the caller waiting; a
 * "status" value nobody recognizes is reported as "invalid" rather than
 * guessed at.
 * @param {unknown} data
 * @returns {{ kind: "ready" | "ui" | "degraded" | "failed" | "starting" | "invalid", stage?: string, error?: string, label?: string }}
 */
export function interpretStartupStatus(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { kind: "invalid" };
    }
    const own = (key) => Object.prototype.hasOwnProperty.call(data, key);
    const status = own("status") ? data.status : undefined;
    const stage = own("stage") && typeof data.stage === "string" ? data.stage : undefined;
    const networkReady = own("network_ready") && data.network_ready === true;
    const uiReady = own("ui_ready") && data.ui_ready === true;
    const networkDegraded = own("network_degraded") && data.network_degraded === true;
    const error = own("error") && typeof data.error === "string" ? data.error : undefined;

    if (status === "failed") {
        // HTTP is up and the backend marked UI as usable: mount the app in
        // degraded mode so settings/interfaces remain reachable for recovery.
        if (uiReady || networkDegraded) {
            return {
                kind: "degraded",
                stage: stage || "failed",
                error,
            };
        }
        return {
            kind: "failed",
            stage: stage || "failed",
            error,
        };
    }
    if (status === "ok" || networkReady) {
        return { kind: "ready", stage: stage || "ready" };
    }
    if (status === "starting") {
        const resolvedStage = stage || "starting";
        const label = STARTUP_STAGE_LABELS[resolvedStage] || "Starting RNS…";
        // HTTP is bound and the shell may mount while RNS/identity finish.
        if (uiReady) {
            return {
                kind: "ui",
                stage: resolvedStage,
                label,
            };
        }
        return {
            kind: "starting",
            stage: resolvedStage,
            label,
        };
    }
    if (!own("status")) {
        // No status key at all: an auth-gated response ({"error": "..."})
        // or any other body that is not shaped like a boot status. The
        // server still answered with a well-formed object, so that is
        // enough to stop waiting and mount, the same as an explicit "ui"
        // state, instead of falling back to "starting" as though nothing
        // had happened.
        return {
            kind: "ui",
            stage: stage || "unknown",
            label: "Opening the app…",
            error,
        };
    }
    // A "status" value present but not one of the ones above. Reported
    // distinctly from the no-status case: this is a body that answered the
    // question and gave a reply nobody here understands, which is worth
    // surfacing as such rather than folding into either "starting" or "ui".
    return { kind: "invalid", stage };
}

/**
 * Poll /api/v1/status until the UI may mount (ui_ready), mesh is ready, or degraded.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   timeoutMs?: number,
 *   onLine?: (text: string) => void,
 *   onErrorState?: () => void,
 *   onDegraded?: (error?: string) => void,
 *   statusUrl?: string,
 *   mountOnUiReady?: boolean,
 * }} [options]
 * @returns {Promise<"ready" | "ui" | "degraded" | false>}
 */
export async function waitForNetworkReady(options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const now = options.now || Date.now;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const timeoutMs = options.timeoutMs ?? 120000;
    const onLine = options.onLine || (() => {});
    const onErrorState = options.onErrorState || (() => {});
    const onDegraded = options.onDegraded || (() => {});
    const statusUrl = options.statusUrl || "/api/v1/status";
    const mountOnUiReady = options.mountOnUiReady !== false;

    const deadline = now() + timeoutMs;
    let delayMs = 200;
    while (now() < deadline) {
        try {
            const response = await fetchImpl(statusUrl, { cache: "no-store" });
            if (response.ok) {
                const data = await response.json();
                const interpreted = interpretStartupStatus(data);
                if (interpreted.kind === "degraded") {
                    onLine(interpreted.error || "RNS unavailable. Opening recovery UI…");
                    onDegraded(interpreted.error);
                    return "degraded";
                }
                if (interpreted.kind === "failed") {
                    onLine(interpreted.error || "Network startup failed.");
                    onErrorState();
                    return false;
                }
                if (interpreted.kind === "ready") {
                    return "ready";
                }
                if (interpreted.kind === "ui" && mountOnUiReady) {
                    onLine(interpreted.label || "Opening the app…");
                    return "ui";
                }
                if (interpreted.kind === "starting" || interpreted.kind === "ui") {
                    onLine(interpreted.label || "Getting things ready…");
                }
            }
        } catch {
            onLine("Still starting…");
        }
        await sleep(delayMs);
        delayMs = Math.min(delayMs + 100, 1000);
    }
    onLine("Network startup timed out. Try reloading.");
    onErrorState();
    return false;
}

/**
 * Continue polling until mesh network_ready or degraded/failed.
 * Used after an early UI mount on ui_ready.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   timeoutMs?: number,
 *   onLine?: (text: string) => void,
 *   onErrorState?: () => void,
 *   onDegraded?: (error?: string) => void,
 *   statusUrl?: string,
 * }} [options]
 * @returns {Promise<"ready" | "degraded" | false>}
 */
export async function waitForMeshReady(options = {}) {
    return waitForNetworkReady({
        ...options,
        mountOnUiReady: false,
    });
}
