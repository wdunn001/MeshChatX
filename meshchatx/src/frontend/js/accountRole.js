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
 * Settings sections that configure the machine rather than the person.
 * Everything absent is a per identity preference and stays available.
 *
 * Naming is here because on a hosted instance the operator points every
 * identity at their own resolvers, seeded by
 * meshchatx/src/backend/instance_defaults.py. It becomes editable again on an
 * install the person runs themselves.
 */
export const SETTINGS_SECTION_MIN_ROLE = {
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
    naming: ROLE_ADMIN,
    blocked: ROLE_CONTRIBUTOR,
    banishment: ROLE_CONTRIBUTOR,
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
