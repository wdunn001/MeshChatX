# SPDX-License-Identifier: 0BSD

"""Oracle: the role each API path needs, predicted from what it costs others.

The table in permissions.py is the whole authorization boundary on a hosted
instance, so it is checked here against a hand-written expectation rather than
against itself. Each case below states the least role that may make the call
and why, and the deny-by-default property is asserted directly on paths that
were never classified.
"""

from __future__ import annotations

import pytest

from meshchatx.src.backend.multiuser import (
    ROLE_ADMIN,
    ROLE_CONTRIBUTOR,
    ROLE_USER,
)
from meshchatx.src.backend.multiuser.permissions import (
    allowed,
    is_public,
    required_role,
)

# (method, path, least role that may call it)
CASES = [
    # Their own conversations and their own address book.
    ("GET", "/api/v1/lxmf-messages/conversations", ROLE_USER),
    ("POST", "/api/v1/lxmf-messages/send", ROLE_USER),
    ("GET", "/api/v1/contacts", ROLE_USER),
    ("POST", "/api/v1/telephone/call/abc", ROLE_USER),
    ("GET", "/api/v1/config", ROLE_USER),
    ("PATCH", "/api/v1/config", ROLE_USER),
    ("POST", "/api/v1/app/hosted-onboarding/welcome/seen", ROLE_USER),
    # Their own mute list, which reaches nobody else.
    ("POST", "/api/v1/lxmf/message-blocklist", ROLE_USER),
    ("POST", "/api/v1/spam-keywords", ROLE_USER),
    # Browsing the mesh, and the pages on the shared node.
    ("GET", "/api/v1/nomadnet/page", ROLE_USER),
    ("GET", "/api/v1/page-nodes", ROLE_USER),
    ("GET", "/api/v1/map/tiles/1/2/3", ROLE_USER),
    # The Network Visualiser draws from these two, read only.
    ("GET", "/api/v1/interface-stats", ROLE_USER),
    ("GET", "/api/v1/reticulum/discovered-interfaces", ROLE_USER),
    ("GET", "/api/v1/ping/abcdef/lxmf.delivery", ROLE_USER),
    # Name resolution reads the person's own config and their own announce
    # store, and every hosted identity is seeded with it switched on.
    ("POST", "/api/v1/resolve", ROLE_USER),
    ("POST", "/api/v1/resolve/pin", ROLE_USER),
    # Publishing to the shared node speaks in the instance's name.
    ("POST", "/api/v1/page-nodes/1/pages", ROLE_CONTRIBUTOR),
    ("POST", "/api/v1/bots/announce", ROLE_CONTRIBUTOR),
    # Banishment blackholes an identity on the shared Reticulum instance, so
    # it reaches every other person signed in to this machine.
    ("GET", "/api/v1/blocked-destinations", ROLE_CONTRIBUTOR),
    ("POST", "/api/v1/blocked-destinations", ROLE_CONTRIBUTOR),
    ("DELETE", "/api/v1/blocked-destinations/abc", ROLE_CONTRIBUTOR),
    # The instance itself.
    ("GET", "/api/v1/interfaces", ROLE_ADMIN),
    ("POST", "/api/v1/reticulum/interfaces", ROLE_ADMIN),
    ("POST", "/api/v1/reticulum/blackhole", ROLE_ADMIN),
    ("GET", "/api/v1/identities", ROLE_ADMIN),
    ("POST", "/api/v1/identities/switch", ROLE_ADMIN),
    ("GET", "/api/v1/multiuser/accounts", ROLE_ADMIN),
    ("DELETE", "/api/v1/multiuser/accounts/2", ROLE_ADMIN),
    ("PATCH", "/api/v1/multiuser/registration", ROLE_ADMIN),
    ("GET", "/api/v1/server/security", ROLE_ADMIN),
    ("GET", "/api/v1/debug/logs", ROLE_ADMIN),
    ("GET", "/api/v1/plugins", ROLE_ADMIN),
    ("POST", "/api/v1/maintenance/announces", ROLE_ADMIN),
    ("GET", "/api/v1/rnstatus", ROLE_ADMIN),
    ("POST", "/api/v1/rnsh/sessions", ROLE_ADMIN),
    ("GET", "/api/v1/repository-server/status", ROLE_ADMIN),
    # Writing to a read-only grant stays admin.
    ("POST", "/api/v1/interface-stats", ROLE_ADMIN),
    ("DELETE", "/api/v1/reticulum/discovered-interfaces", ROLE_ADMIN),
    # Never classified at all, so admin by the deny-by-default rule.
    ("GET", "/api/v1/an-endpoint-nobody-has-classified", ROLE_ADMIN),
    ("POST", "/api/v1/future/feature", ROLE_ADMIN),
]


@pytest.mark.parametrize(("method", "path", "expected"), CASES)
def test_required_role_matches_the_hand_written_expectation(method, path, expected):
    assert required_role(method, path) == expected


@pytest.mark.parametrize(("method", "path", "expected"), CASES)
def test_a_role_reaches_exactly_what_it_is_granted(method, path, expected):
    ranked = [ROLE_USER, ROLE_CONTRIBUTOR, ROLE_ADMIN]
    cutoff = ranked.index(expected)
    for index, role in enumerate(ranked):
        assert allowed(role, method, path) is (index >= cutoff)
    # No session at all reaches nothing outside the public list.
    assert allowed(None, method, path) is False


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/status",
        "/api/v1/auth/stamp/challenge",
        "/api/v1/status",
        "/api/v1/multiuser/status",
        "/api/v1/multiuser/register",
        "/api/v1/multiuser/login",
        "/api/v1/multiuser/logout",
        "/api/v1/multiuser/me",
    ],
)
def test_the_sign_in_surface_is_reachable_before_anyone_is_signed_in(path):
    assert is_public(path) is True
    assert allowed(None, "GET", path) is True
    assert allowed(None, "POST", path) is True


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/multiuser/accounts",
        "/api/v1/multiuser/registration",
    ],
)
def test_the_admin_account_routes_are_not_swept_in_by_the_public_prefixes(path):
    assert is_public(path) is False
    assert allowed(None, "GET", path) is False
    assert allowed(ROLE_USER, "GET", path) is False


def test_a_prefix_never_matches_a_longer_neighbouring_word():
    # "/api/v1/identity" is per identity and granted to a user. "/api/v1/
    # identities" administers everyone's identities and must not be caught by
    # it, which is the difference between a person editing their own display
    # name and a person switching the instance to somebody else's keys.
    assert required_role("GET", "/api/v1/identity") == ROLE_USER
    assert required_role("GET", "/api/v1/identities") == ROLE_ADMIN
    assert required_role("POST", "/api/v1/identities/switch") == ROLE_ADMIN


def test_the_app_shell_and_its_assets_are_not_gated_by_role():
    for path in ("/", "/index.html", "/assets/app.js", "/favicon.ico"):
        assert allowed(None, "GET", path) is True
