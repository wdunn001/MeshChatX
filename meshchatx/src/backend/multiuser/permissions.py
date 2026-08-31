# SPDX-License-Identifier: 0BSD
"""What each role may reach on a shared instance.

Deny by default. A path that is not granted to a role is admin only, so an
endpoint added later is closed until someone decides otherwise, rather than
being exposed by having been forgotten. That is the opposite of the usual
default, and it is right here because the people signing in are strangers.

The split follows what a thing costs other people, not how dangerous it sounds.

  user         Their own conversations, calls, contacts, and browsing. All of
               it is per identity, so one person's use does not reach another's
               data. Airtime is shared, and that is what rate limiting is for.

  contributor  Publishing to the shared Mesh Server node, and running bots.
               Both speak to the mesh in the instance's name rather than the
               person's, which is a question of trust rather than safety. Bot
               code is not user supplied: there are three fixed templates, so
               the cost of a bot is a process, not arbitrary execution.

  admin        The instance itself: interfaces, transport, security, other
               people's identities, maintenance, plugins.

Enforced in middleware rather than in the routes, so core code carries none of
it and the whole mechanism is absent when the feature is off.
"""

from meshchatx.src.backend.multiuser import (
    ROLE_ADMIN,
    ROLE_CONTRIBUTOR,
    ROLE_USER,
    role_allows,
)

# Reachable by anyone, signed in or not. Sign in itself has to be, or nobody
# could ever sign in. Status is here too: this instance runs its network
# stack independently of any browser session, so the frontend boot gate has
# to be able to learn the app is up before there is anyone to sign in as.
# The route itself keeps the detailed payload behind whether a context is
# bound to the request, so being public here only ever hands out readiness.
PUBLIC_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/status",
    "/api/v1/multiuser/status",
    "/api/v1/multiuser/register",
    "/api/v1/multiuser/login",
    "/api/v1/multiuser/logout",
    "/api/v1/multiuser/me",
)

# What an ordinary person needs to use the mesh: talk, call, browse, and set
# their own preferences. Every one of these is scoped to their own identity.
USER_PREFIXES = (
    "/api/v1/app",
    "/api/v1/config",
    "/api/v1/announces",
    "/api/v1/announce",
    "/api/v1/destination",
    "/api/v1/identity",
    "/api/v1/lxmf",
    "/api/v1/lxmf-messages",
    "/api/v1/telephone",
    "/api/v1/rrc",
    "/api/v1/nomadnet",
    "/api/v1/page-nodes",
    "/api/v1/favourites",
    "/api/v1/contacts",
    "/api/v1/blocked-destinations",
    "/api/v1/spam-keywords",
    "/api/v1/notifications",
    "/api/v1/notification-sounds",
    "/api/v1/stickers",
    "/api/v1/sticker-packs",
    "/api/v1/gifs",
    "/api/v1/map",
    "/api/v1/docs",
    "/api/v1/meshchatx-docs",
    "/api/v1/translator",
    "/api/v1/filesync",
    "/api/v1/path-table",
)

# Publishing and automation. Speaks in the instance's name, so it is a step up
# in trust rather than in privilege.
CONTRIBUTOR_PREFIXES = (
    "/api/v1/bots",
)

# Reading the shared node's pages is browsing. Writing to it is publishing.
CONTRIBUTOR_WRITE_PREFIXES = (
    "/api/v1/page-nodes",
)

_WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def _matches(path: str, prefixes) -> bool:
    return any(path == p or path.startswith(p + "/") or path.startswith(p + "?")
               for p in prefixes)


def is_public(path: str) -> bool:
    return any(path.startswith(p) for p in PUBLIC_PREFIXES)


def required_role(method: str, path: str) -> str:
    """The least role that may make this call.

    Anything not named is admin, which is what makes this deny by default.
    """
    if _matches(path, CONTRIBUTOR_PREFIXES):
        return ROLE_CONTRIBUTOR
    # Publishing to the shared node is a contributor act, reading it is not.
    if method in _WRITE_METHODS and _matches(path, CONTRIBUTOR_WRITE_PREFIXES):
        return ROLE_CONTRIBUTOR
    if _matches(path, USER_PREFIXES):
        return ROLE_USER
    return ROLE_ADMIN


def allowed(role: str | None, method: str, path: str) -> bool:
    """True when a role may make this call."""
    if is_public(path):
        return True
    if not path.startswith("/api/"):
        # Static assets and the app shell. The UI hides what a role cannot
        # use, and the API above is what actually enforces it.
        return True
    return role_allows(role, required_role(method, path))
