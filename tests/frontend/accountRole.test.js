// SPDX-License-Identifier: 0BSD

import { describe, expect, it } from "vitest";
import {
    accountAllows,
    effectiveRole,
    isHostedInstance,
    isInstanceAdmin,
    navEntryAllowed,
    roleAllows,
    routeAllowed,
    settingsSectionAllowed,
} from "@/js/accountRole.js";
import { CORE_NAV_ENTRIES } from "@/js/registries/coreNavEntries.js";

const hosted = (role) => ({ authMode: "accounts", accountRole: role });
const desktop = { authMode: null, accountRole: null };
const singlePassword = { authMode: "single", accountRole: null };
const openInstance = { authMode: "open", accountRole: null };

describe("roleAllows", () => {
    it("ranks user below contributor below admin", () => {
        expect(roleAllows("admin", "user")).toBe(true);
        expect(roleAllows("admin", "contributor")).toBe(true);
        expect(roleAllows("contributor", "user")).toBe(true);
        expect(roleAllows("contributor", "admin")).toBe(false);
        expect(roleAllows("user", "contributor")).toBe(false);
        expect(roleAllows("user", "admin")).toBe(false);
    });

    it("grants nothing for a role or requirement it does not know", () => {
        expect(roleAllows(null, "user")).toBe(false);
        expect(roleAllows("", "user")).toBe(false);
        expect(roleAllows("owner", "user")).toBe(false);
        expect(roleAllows("admin", "superuser")).toBe(false);
    });
});

describe("which instances have roles at all", () => {
    it("only an accounts instance is hosted", () => {
        expect(isHostedInstance(hosted("user"))).toBe(true);
        expect(isHostedInstance(desktop)).toBe(false);
        expect(isHostedInstance(singlePassword)).toBe(false);
        expect(isHostedInstance(openInstance)).toBe(false);
        expect(isHostedInstance(null)).toBe(false);
    });

    it("one person operating their own node reaches everything", () => {
        for (const state of [desktop, singlePassword, openInstance]) {
            expect(effectiveRole(state)).toBe("admin");
            expect(isInstanceAdmin(state)).toBe(true);
            expect(routeAllowed("interfaces", state)).toBe(true);
            expect(routeAllowed("identities", state)).toBe(true);
            expect(settingsSectionAllowed("maintenance", state)).toBe(true);
            expect(settingsSectionAllowed("naming", state)).toBe(true);
        }
    });

    it("a hosted session whose role is not read back yet reaches nothing", () => {
        const unresolved = { authMode: "accounts", accountRole: null };
        expect(effectiveRole(unresolved)).toBe(null);
        expect(accountAllows(unresolved, "user")).toBe(false);
        expect(routeAllowed("interfaces", unresolved)).toBe(false);
        expect(settingsSectionAllowed("transport", unresolved)).toBe(false);
    });
});

describe("routeAllowed", () => {
    const adminOnly = [
        "interfaces",
        "interfaces.add",
        "interfaces.edit",
        "identities",
        "accounts-admin",
        "rnstatus",
        "rnpath",
        "rnpath-trace",
        "rnprobe",
        "rnsh",
        "rnx",
        "rncp",
        "reticulum-config-editor",
        "rnode-flasher",
        "repository-server",
        "debug-logs",
        "forwarder",
    ];
    const contributorOnly = ["blocked", "mesh-server", "micron-editor", "bots"];
    const everyone = [
        "messages",
        "call",
        "contacts",
        "relay-chat",
        "nomadnetwork",
        "map",
        "network-visualiser",
        "archives",
        "settings",
        "about",
        "tools",
        "documentation",
        "profile.icon",
        "sieve-filters",
        "message-blocklist",
        "translator",
        "propagation-nodes",
    ];

    it.each(adminOnly)("keeps %s to the person who runs the instance", (name) => {
        expect(routeAllowed(name, hosted("user"))).toBe(false);
        expect(routeAllowed(name, hosted("contributor"))).toBe(false);
        expect(routeAllowed(name, hosted("admin"))).toBe(true);
    });

    it.each(contributorOnly)("keeps %s to contributors and above", (name) => {
        expect(routeAllowed(name, hosted("user"))).toBe(false);
        expect(routeAllowed(name, hosted("contributor"))).toBe(true);
        expect(routeAllowed(name, hosted("admin"))).toBe(true);
    });

    it.each(everyone)("leaves %s open to an ordinary account", (name) => {
        expect(routeAllowed(name, hosted("user"))).toBe(true);
    });
});

describe("settingsSectionAllowed", () => {
    // Withheld on a shared emergency onboarding portal. Most are stored per
    // identity and would harm nobody else; they are withheld because a switch
    // somebody does not understand can cost them their own line of contact.
    const withheld = [
        "transport",
        "interfaces",
        "networkSecurity",
        "visualiser",
        "crawler",
        "telephony",
        "archiver",
        "nomadRenderer",
        "naming",
        "strangerProtection",
        "messages",
        "notificationSounds",
        "propagation",
        "stickers",
        "gifs",
        "privacyData",
        "auth",
        "webExposure",
        "csp",
        "maintenance",
        "selftest",
        "infrastructure",
        "plugins",
        "battery",
    ];
    // Cannot cost anyone a conversation.
    const personal = ["language", "appearance", "desktop", "android", "shortcuts", "location"];

    it.each(withheld)("hides %s from an ordinary hosted account", (key) => {
        expect(settingsSectionAllowed(key, hosted("user"))).toBe(false);
        expect(settingsSectionAllowed(key, hosted("admin"))).toBe(true);
    });

    it.each(personal)("leaves %s available to an ordinary hosted account", (key) => {
        expect(settingsSectionAllowed(key, hosted("user"))).toBe(true);
    });

    it("leaves every section alone on an install the person runs themselves", () => {
        // The way out of the narrow portal is the PWA or a desktop install,
        // where the blast radius is their own machine.
        for (const key of [...withheld, ...personal]) {
            expect(settingsSectionAllowed(key, desktop)).toBe(true);
        }
    });

    it("keeps banishment to contributors, since it blackholes on the shared instance", () => {
        expect(settingsSectionAllowed("banishment", hosted("user"))).toBe(false);
        expect(settingsSectionAllowed("blocked", hosted("user"))).toBe(false);
        expect(settingsSectionAllowed("banishment", hosted("contributor"))).toBe(true);
    });
});

describe("navEntryAllowed over the real nav registry", () => {
    const byId = (id) => CORE_NAV_ENTRIES.find((entry) => entry.id === id);

    it("gives an ordinary account the pages they came for", () => {
        const state = hosted("user");
        const visible = CORE_NAV_ENTRIES.filter((entry) => navEntryAllowed(entry, state)).map((entry) => entry.id);
        expect(visible).toEqual([
            "messages",
            "call",
            "contacts",
            "relay-chat",
            "nomadnetwork",
            "map",
            "network-visualiser",
            "tools",
            "settings",
            "archives",
            "about",
        ]);
    });

    it("withholds the instance's own pages from them", () => {
        const state = hosted("user");
        expect(navEntryAllowed(byId("interfaces"), state)).toBe(false);
        expect(navEntryAllowed(byId("identities"), state)).toBe(false);
        expect(navEntryAllowed(byId("blocked"), state)).toBe(false);
        expect(navEntryAllowed(byId("accounts-admin"), state)).toBe(false);
    });

    it("gives the operator every entry", () => {
        const state = hosted("admin");
        for (const entry of CORE_NAV_ENTRIES) {
            expect(navEntryAllowed(entry, state)).toBe(true);
        }
    });

    it("leaves a desktop install exactly as it was", () => {
        for (const entry of CORE_NAV_ENTRIES) {
            expect(navEntryAllowed(entry, desktop)).toBe(true);
        }
    });
});
