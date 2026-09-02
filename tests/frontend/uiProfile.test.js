// SPDX-License-Identifier: 0BSD

/**
 * The browser is the machine's, not the person's, on a shared terminal.
 *
 * These cover the three things that has to mean: nothing of theirs is left
 * behind, nothing of somebody else's is picked up, and their own settings come
 * back when they return.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    BROWSER_STATE_KEYS,
    applyBrowserState,
    clearBrowserState,
    loadUiProfile,
    readBrowserState,
    saveUiProfile,
} from "@/js/uiProfile.js";

describe("BROWSER_STATE_KEYS", () => {
    it("lists every key once", () => {
        expect(new Set(BROWSER_STATE_KEYS).size).toBe(BROWSER_STATE_KEYS.length);
    });

    it("covers the stores that hold somebody's own words or choices", () => {
        // Drafts are the one store already bucketed by identity, so the next
        // person is never shown them. The text still sits in a shared browser,
        // which is why it is carried here rather than left alone.
        expect(BROWSER_STATE_KEYS).toContain("meshchat.drafts");
        // A dismissal by one person must not silence the prompt for the next.
        expect(BROWSER_STATE_KEYS).toContain("meshchatx.post_install_prompts_seen");
        expect(BROWSER_STATE_KEYS).toContain("integrity_warning_dismissed");
        // Preferences with no per identity key behind them.
        expect(BROWSER_STATE_KEYS).toContain("meshchatx.translateTargetLang");
        expect(BROWSER_STATE_KEYS).toContain("meshchatx.visualiser.renderer");
    });
});

describe("reading, clearing and restoring", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it("reads only the keys it knows, and only when they are set", () => {
        localStorage.setItem("meshchat.drafts", '{"abc":{"def":"unsent words"}}');
        localStorage.setItem("meshchatx_ui_theme", "dark");
        localStorage.setItem("something.else.entirely", "left alone");

        const profile = readBrowserState();
        expect(profile["meshchat.drafts"]).toBe('{"abc":{"def":"unsent words"}}');
        expect(profile["meshchatx_ui_theme"]).toBe("dark");
        expect(profile).not.toHaveProperty("something.else.entirely");
        expect(profile).not.toHaveProperty("meshchatx.translateTargetLang");
    });

    it("leaves nothing of this person behind, and nothing of anyone else's either", () => {
        for (const key of BROWSER_STATE_KEYS) {
            localStorage.setItem(key, "theirs");
        }
        localStorage.setItem("unrelated", "keep me");

        clearBrowserState();

        for (const key of BROWSER_STATE_KEYS) {
            expect(localStorage.getItem(key)).toBe(null);
        }
        expect(localStorage.getItem("unrelated")).toBe("keep me");
    });

    it("restores a stored profile", () => {
        applyBrowserState({
            "meshchat.drafts": '{"abc":{"def":"mine"}}',
            "meshchatx_ui_theme": "dark",
        });
        expect(localStorage.getItem("meshchat.drafts")).toBe('{"abc":{"def":"mine"}}');
        expect(localStorage.getItem("meshchatx_ui_theme")).toBe("dark");
    });

    it("refuses keys it does not know, so a newer profile cannot plant storage in an older build", () => {
        applyBrowserState({
            "meshchatx_ui_theme": "dark",
            "some.future.key": "injected",
            "meshchat.drafts": { not: "a string" },
        });
        expect(localStorage.getItem("meshchatx_ui_theme")).toBe("dark");
        expect(localStorage.getItem("some.future.key")).toBe(null);
        expect(localStorage.getItem("meshchat.drafts")).toBe(null);
    });

    it("ignores a profile that is not an object", () => {
        expect(() => applyBrowserState(null)).not.toThrow();
        expect(() => applyBrowserState("nope")).not.toThrow();
        expect(localStorage.length).toBe(0);
    });
});

describe("talking to the server", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
        delete window.api;
    });

    it("applies what the server returns", async () => {
        const api = { get: vi.fn().mockResolvedValue({ data: { profile: { meshchatx_ui_theme: "dark" } } }) };
        await expect(loadUiProfile(api)).resolves.toBe(true);
        expect(localStorage.getItem("meshchatx_ui_theme")).toBe("dark");
    });

    it("leaves the person on defaults when the profile cannot be read", async () => {
        const api = { get: vi.fn().mockRejectedValue(new Error("offline")) };
        await expect(loadUiProfile(api)).resolves.toBe(false);
        expect(localStorage.length).toBe(0);
    });

    it("reports an empty profile rather than pretending it applied one", async () => {
        const api = { get: vi.fn().mockResolvedValue({ data: {} }) };
        await expect(loadUiProfile(api)).resolves.toBe(false);
    });

    it("sends the current browser state under one profile field", async () => {
        localStorage.setItem("meshchatx_ui_theme", "dark");
        const api = { put: vi.fn().mockResolvedValue({ data: {} }) };
        await expect(saveUiProfile(api)).resolves.toBe(true);
        expect(api.put).toHaveBeenCalledWith("/api/v1/app/ui-profile", {
            profile: { meshchatx_ui_theme: "dark" },
        });
    });

    it("does not fail a sign out when the save is refused", async () => {
        const api = { put: vi.fn().mockRejectedValue(new Error("refused")) };
        await expect(saveUiProfile(api)).resolves.toBe(false);
    });
});
