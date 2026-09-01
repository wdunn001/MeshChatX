# SPDX-License-Identifier: 0BSD

"""Oracle: which paths the shared-instance meter counts, and which it leaves.

The meter exists to stop one account holding the radio open while everyone
else on the machine waits. It must therefore catch the calls that put bytes on
an interface, and must not catch the neighbouring paths that only read or
write locally. A path caught by mistake spends somebody's quota on nothing:
the announce budget defaults to six an hour, so one over-broad prefix turns
browsing the announce list into a 429.
"""

from __future__ import annotations

import pytest

from meshchatx.src.backend.multiuser.middleware import _limited_service
from meshchatx.src.backend.multiuser.rate_limit import DEFAULT_LIMITS

# (method, path, the service it counts against, or None for not metered)
CASES = [
    # Spends airtime, and is counted.
    ("POST", "/api/v1/lxmf-messages/send", "send_message"),
    ("GET", "/api/v1/announce", "announce"),
    ("POST", "/api/v1/telephone/call/abc123", "call"),
    ("POST", "/api/v1/filesync/upload", "file_transfer"),
    ("POST", "/api/v1/filesync/start", "file_transfer"),
    ("GET", "/api/v1/ping/abcdef/lxmf.delivery", "probe"),
    ("POST", "/api/v1/resolve", "resolve"),
    # Reads and local writes that sit next to a metered path. Each of these is
    # a prefix match away from the entry above it.
    ("GET", "/api/v1/announces", None),
    ("GET", "/api/v1/announces/search", None),
    ("POST", "/api/v1/resolve/pin", None),
    ("GET", "/api/v1/pings", None),
    ("POST", "/api/v1/filesync/uploads-history", None),
    # Right path, wrong method.
    ("POST", "/api/v1/announce", None),
    ("GET", "/api/v1/lxmf-messages/send", None),
    ("GET", "/api/v1/resolve", None),
    # Nothing to do with the meter.
    ("GET", "/api/v1/config", None),
    ("GET", "/api/v1/interfaces", None),
]


@pytest.mark.parametrize(("method", "path", "expected"), CASES)
def test_the_meter_counts_exactly_the_paths_that_spend_airtime(method, path, expected):
    assert _limited_service(method, path) == expected


def test_every_metered_service_has_a_default_limit():
    # A service named in the middleware with no entry here is silently
    # unlimited when an operator turns limiting on without naming it.
    services = {service for _, _, service in CASES if service is not None}
    missing = sorted(service for service in services if service not in DEFAULT_LIMITS)
    assert not missing, f"metered services with no default limit: {missing}"


def test_a_trailing_slash_prefix_still_matches_what_follows_it():
    # The call path carries a destination hash after it, so that entry is
    # written with a trailing slash and is meant to match anything below.
    assert _limited_service("POST", "/api/v1/telephone/call/") == "call"
    assert _limited_service("POST", "/api/v1/telephone/call/deadbeef") == "call"
    # And it must not reach a sibling that merely starts the same way.
    assert _limited_service("POST", "/api/v1/telephone/calls") is None
