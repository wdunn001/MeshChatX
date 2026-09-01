// SPDX-License-Identifier: 0BSD

/**
 * A refusal about the account's ROLE must not be read as a missing session.
 *
 * onAuthError in main.js sends people back to the sign in page. That was
 * correct while 403 could only mean an expired session. Once roles existed, a
 * single page fetching a single endpoint above its role signed the person
 * straight out: Settings rendered, PluginsSettingsSection asked for
 * /api/v1/plugins, and the 403 threw a perfectly valid session back to the
 * entry gate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient, isCsrfRejection, isRoleRejection } from "@/js/apiClient.js";

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
});

describe("isRoleRejection", () => {
    it("recognises the middleware's role refusal", () => {
        expect(
            isRoleRejection(403, {
                error: "This instance is shared, and your account does not have access to that.",
                required_role: "admin",
            }),
        ).toBe(true);
    });

    it("does not claim a plain 403 with no named role", () => {
        expect(isRoleRejection(403, { error: "Forbidden" })).toBe(false);
        expect(isRoleRejection(403, {})).toBe(false);
        expect(isRoleRejection(403, null)).toBe(false);
        expect(isRoleRejection(403, "Forbidden")).toBe(false);
        expect(isRoleRejection(403, { required_role: "" })).toBe(false);
    });

    it("does not claim a 401, which really is a missing session", () => {
        expect(isRoleRejection(401, { required_role: "admin" })).toBe(false);
    });

    it("stays distinct from a CSRF rejection", () => {
        const csrf = { error: "CSRF token missing or invalid" };
        expect(isCsrfRejection(403, csrf)).toBe(true);
        expect(isRoleRejection(403, csrf)).toBe(false);
    });
});

describe("createApiClient auth error handling", () => {
    let onAuthError;

    beforeEach(() => {
        onAuthError = vi.fn();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const call = async (status, body) => {
        global.fetch.mockResolvedValue(jsonResponse(status, body));
        const api = createApiClient({ onAuthError });
        await expect(api.get("/api/v1/plugins")).rejects.toThrow();
    };

    it("keeps the session when the role is too low", async () => {
        await call(403, {
            error: "This instance is shared, and your account does not have access to that.",
            required_role: "admin",
        });
        expect(onAuthError).not.toHaveBeenCalled();
    });

    it("still signs out on a 401", async () => {
        await call(401, { error: "Sign in to use this instance" });
        expect(onAuthError).toHaveBeenCalledTimes(1);
    });

    it("still signs out on a 403 that names no role", async () => {
        await call(403, { error: "Forbidden" });
        expect(onAuthError).toHaveBeenCalledTimes(1);
    });
});
