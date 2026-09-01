// SPDX-License-Identifier: 0BSD

/**
 * What the signed-in account may reach, for the UI.
 *
 * The authority is the backend: meshchatx/src/backend/multiuser/permissions.py
 * refuses a request whatever the UI shows, and it denies by default. This is
 * the other half of that, and it exists so an ordinary person on a shared
 * instance is not offered Interfaces, Identities, or the maintenance settings
 * and then handed a 403 for taking the offer. The tables here mirror that file
 * and must be changed with it.
 *
 * Outside a hosted instance there are no roles at all. A desktop install, an
 * Electron build, an Android build, and a single password instance are one
 * person operating their own node, so every gate below opens.
 */

export const ROLE_USER = "user";
export const ROLE_CONTRIBUTOR = "contributor";
export const ROLE_ADMIN = "admin";

const ROLE_RANK = {
    [ROLE_USER]: 0,
    [ROLE_CONTRIBUTOR]: 1,
    [ROLE_ADMIN]: 2,
};

/** True when role is at least required. An unknown role grants nothing. */
export function roleAllows(role, required) {
    const held = ROLE_RANK[role];
    const needed = ROLE_RANK[required];
    if (held == null || needed == null) {
        return false;
    }
    return held >= needed;
}

/** True on an instance where several people sign in as themselves. */
export function isHostedInstance(state) {
    return state?.authMode === "accounts";
}

/**
 * The role to gate on. Full access anywhere roles do not exist, and nothing at
 * all on a hosted instance whose role has not been read back yet, so a surface
 * never flashes into view and then disappears.
 */
export function effectiveRole(state) {
    if (!isHostedInstance(state)) {
        return ROLE_ADMIN;
    }
    return state?.accountRole || null;
}

/** True when this account may use something needing the given role. */
export function accountAllows(state, required) {
    if (!required || required === ROLE_USER) {
        return !isHostedInstance(state) || Boolean(effectiveRole(state));
    }
    return roleAllows(effectiveRole(state), required);
}

/** True when this account administers the instance itself. */
export function isInstanceAdmin(state) {
    return accountAllows(state, ROLE_ADMIN);
}

/**
 * Routes that reach beyond the person using them. Each name here calls at
 * least one endpoint that permissions.py grants to admin or contributor only,
 * so an ordinary account reaching the page would see it fail rather than work.
 * Anything absent is a per identity surface and needs no entry.
 */
export const ROUTE_MIN_ROLE = {
    interfaces: ROLE_ADMIN,
    "interfaces.add": ROLE_ADMIN,
    "interfaces.edit": ROLE_ADMIN,
    identities: ROLE_ADMIN,
    "accounts-admin": ROLE_ADMIN,
    rnstatus: ROLE_ADMIN,
    rnpath: ROLE_ADMIN,
    "rnpath-trace": ROLE_ADMIN,
    rnprobe: ROLE_ADMIN,
    rnsh: ROLE_ADMIN,
    rnx: ROLE_ADMIN,
    rncp: ROLE_ADMIN,
    "reticulum-config-editor": ROLE_ADMIN,
    "rnode-flasher": ROLE_ADMIN,
    "repository-server": ROLE_ADMIN,
    "debug-logs": ROLE_ADMIN,
    forwarder: ROLE_ADMIN,
    // Banishment blackholes an identity on the shared Reticulum instance, so
    // one person using it changes the network for everyone signed in here.
    blocked: ROLE_CONTRIBUTOR,
    // Publishing to the shared node, and running bots, speak in the
    // instance's name rather than the person's.
    "mesh-server": ROLE_CONTRIBUTOR,
    "micron-editor": ROLE_CONTRIBUTOR,
    bots: ROLE_CONTRIBUTOR,
};

/**
 * Settings sections a hosted account does not get, and why each one.
 *
 * This portal is a shared onboarding resource for emergency communications.
 * Two tests withhold a section, and a section needs to fail only one of them.
 * They are listed separately below because the reason decides who gets it back
 * and when, and because a section can fail one test while passing the other.
 *
 * Test one, reach: the setting changes the machine or the people on it.
 * Test two, contact: a person could cut off their own line of contact with a
 * switch they did not understand. On an emergency system that outcome is as
 * serious as breaking it for everybody, and it needs no shared resource to
 * happen.
 *
 * Test two is why this list is wider than the code strictly requires. Most of
 * these are stored per identity and would harm nobody else. They are withheld
 * anyway, because the cost of a wrong switch is a person who cannot be
 * reached, and the administrator can make the adjustment for them.
 *
 * The way out is not a wider portal. Pulling down the PWA gives somebody the
 * whole application on their own node, where all of this is theirs again and
 * the blast radius is their own machine.
 */
export const SETTINGS_SECTION_MIN_ROLE = {
    // Reach. The shared radio and the instance's own exposure.
    transport: ROLE_ADMIN,
    interfaces: ROLE_ADMIN,
    networkSecurity: ROLE_ADMIN,
    auth: ROLE_ADMIN,
    webExposure: ROLE_ADMIN,
    csp: ROLE_ADMIN,
    maintenance: ROLE_ADMIN,
    selftest: ROLE_ADMIN,
    infrastructure: ROLE_ADMIN,
    plugins: ROLE_ADMIN,
    // Reach. Sets bitrate limits on interfaces everyone is sharing.
    battery: ROLE_ADMIN,
    // Reach. Crawling NomadNet spends the shared radio on somebody else's
    // behalf.
    crawler: ROLE_ADMIN,
    // Reach, and contact. This section carries the Reload RNS button, which
    // restarts the stack under everyone signed in, alongside the propagation
    // node choice that decides whether this person's messages get anywhere.
    propagation: ROLE_ADMIN,
    // Reach. Banishment blackholes an identity on the shared Reticulum
    // instance, so it drops that peer for every account on the box. It is a
    // moderation act rather than an administrative one, so it stops at
    // contributor.
    blocked: ROLE_CONTRIBUTOR,
    banishment: ROLE_CONTRIBUTOR,
    // Contact. Stranger protection decides who may reach this person at all.
    // Wrong here and a legitimate contact never arrives, with nothing on
    // screen to say why.
    strangerProtection: ROLE_ADMIN,
    // Contact. Delivery limits, retention and auto-resend all decide whether a
    // message survives, and they sit beside settings that only change colours.
    messages: ROLE_ADMIN,
    // Contact. An inbound message nobody hears about is a message missed.
    notificationSounds: ROLE_ADMIN,
    // Contact. Naming is pointed at the operator's own resolvers by
    // meshchatx/src/backend/instance_defaults.py. Repointing it is how a
    // person stops being able to reach anyone by name.
    naming: ROLE_ADMIN,
    // Contact. Renderer and archiver settings decide whether pages arrive
    // readable or at all.
    nomadRenderer: ROLE_ADMIN,
    archiver: ROLE_ADMIN,
    // Contact. Call setup and codec choices decide whether a call connects.
    telephony: ROLE_ADMIN,
    // Contact. Data retention and purge can remove the history somebody needs.
    privacyData: ROLE_ADMIN,
    // Weakest case of the set, and the first to reconsider. Uploads land in
    // this identity's own storage, so the reach is the machine's disk rather
    // than anyone else's data, and nothing here costs a conversation. They are
    // withheld for now because they sit in the same tab as the settings above.
    stickers: ROLE_ADMIN,
    gifs: ROLE_ADMIN,
    visualiser: ROLE_ADMIN,
};

/** True when this account may open a route. */
export function routeAllowed(routeName, state) {
    const required = ROUTE_MIN_ROLE[routeName];
    if (!required) {
        return true;
    }
    return accountAllows(state, required);
}

/** True when this account may see a settings section. */
export function settingsSectionAllowed(sectionKey, state) {
    const required = SETTINGS_SECTION_MIN_ROLE[sectionKey];
    if (!required) {
        return true;
    }
    return accountAllows(state, required);
}

/** True when a nav entry belongs in this account's sidebar. */
export function navEntryAllowed(entry, state) {
    if (!entry) {
        return false;
    }
    const required = entry.minRole || ROUTE_MIN_ROLE[entry.route?.name];
    if (!required) {
        return true;
    }
    return accountAllows(state, required);
}
