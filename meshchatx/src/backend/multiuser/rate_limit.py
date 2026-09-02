# SPDX-License-Identifier: 0BSD
"""Optional rate limiting, per service, for an instance open to strangers.

Off unless an operator turns it on, because it is a blunt instrument and the
common case is a small trusted group. When a hundred people are queuing at an
access point, a limit that is too tight is worse than no limit at all.

What this protects is the instance, not the mesh: the shared machine and the
interfaces running on it. One account should not be able to hold the radio or
the hub open and starve everyone else signed in to the same box.

So a limit counts against an ACCOUNT wherever one is signed in. That is the
thing consuming the machine, and it follows the person across addresses and
devices. An address is used only before anyone is signed in, for sign up and
sign in, and even then it is resolved with the project's proxy aware helper
rather than the socket peer, because behind a proxy every device shares one
address and limiting it would punish a whole room for one person.

Configure under multiuser_rate_limits in app_security.json:

    "multiuser_rate_limits": {
        "enabled": true,
        "register": {"max": 20, "window_seconds": 3600},
        "send_message": {"max": 60, "window_seconds": 60},
        "announce": false
    }
"""

import threading
import time

from meshchatx.src.backend.app_security_settings import (
    get_trusted_proxy_cidrs,
    load_app_security_settings,
)
from meshchatx.src.path_utils import request_client_ip

SETTINGS_KEY = "multiuser_rate_limits"

# Used only when an operator switches limiting on without saying what the
# limits are. Deliberately loose: they exist to stop a script hammering the
# endpoint, not to ration a room full of people signing up at once.
DEFAULT_LIMITS = {
    # Before anyone is signed in, so these count against an address.
    "register": {"max": 20, "window_seconds": 3600},
    "login": {"max": 30, "window_seconds": 300},
    # Signed in, so these count against the account. These are the ones that
    # matter for the shared machine, because each spends airtime on interfaces
    # everyone is using. A LoRa link carries a few hundred bytes a second, so
    # one account sending continuously is enough to starve the rest.
    "send_message": {"max": 60, "window_seconds": 60},
    "announce": {"max": 6, "window_seconds": 3600},
    "file_transfer": {"max": 10, "window_seconds": 3600},
    "call": {"max": 10, "window_seconds": 3600},
    "probe": {"max": 30, "window_seconds": 3600},
    "resolve": {"max": 60, "window_seconds": 3600},
}

_hits: dict[tuple[str, str], list[float]] = {}
_lock = threading.Lock()


def limits_for(storage_dir, service: str):
    """The limit for a service, or None when limiting is off for it.

    Returns (max_events, window_seconds).
    """
    try:
        settings = load_app_security_settings(storage_dir) if storage_dir else {}
    except Exception:
        return None
    config = settings.get(SETTINGS_KEY)
    if not isinstance(config, dict) or not config.get("enabled", False):
        return None

    entry = config.get(service)
    if entry is False:
        # An operator can switch off one service while limiting the rest.
        return None
    if not isinstance(entry, dict):
        entry = DEFAULT_LIMITS.get(service)
    if not isinstance(entry, dict):
        return None

    try:
        maximum = int(entry.get("max", 0))
        window = float(entry.get("window_seconds", 0))
    except (TypeError, ValueError):
        return None
    if maximum <= 0 or window <= 0:
        return None
    return maximum, window


def limit_key(request, storage_dir, account=None) -> str:
    """What the limit counts against.

    An account when one is signed in, because that is the thing consuming the
    machine and its interfaces, and it survives the person changing address or
    device. An address otherwise, for the calls that happen before anyone is
    signed in.

    Note what is deliberately NOT keyed: a sign in attempt is never counted
    against the username it names. Doing that would let anyone lock a chosen
    person out by guessing at their name repeatedly.
    """
    if account is not None:
        try:
            return "account:%s" % account["username"]
        except (KeyError, TypeError, IndexError):
            pass
    try:
        address = request_client_ip(request, get_trusted_proxy_cidrs(storage_dir))
    except Exception:
        address = (request.remote or "unknown").strip() or "unknown"
    return "addr:%s" % address


def check(request, storage_dir, service: str, account=None) -> bool:
    """True when the call may proceed. Records the call when it may.

    Returns True whenever limiting is off, so callers need no second check.
    """
    limit = limits_for(storage_dir, service)
    if limit is None:
        return True
    maximum, window = limit
    key = (service, limit_key(request, storage_dir, account))
    now = time.time()
    with _lock:
        seen = [t for t in _hits.get(key, []) if now - t < window]
        if len(seen) >= maximum:
            _hits[key] = seen
            return False
        seen.append(now)
        _hits[key] = seen
    return True


def retry_after(storage_dir, service: str) -> int:
    """Seconds a caller should wait, for the Retry-After header."""
    limit = limits_for(storage_dir, service)
    return int(limit[1]) if limit else 0


def account_for_request(app, request_session_username):
    """Look up the signed in account, or None. Never raises."""
    store = getattr(app, "account_store", None)
    if store is None or not request_session_username:
        return None
    try:
        return store.get_by_username(request_session_username)
    except Exception:
        return None


def reset():
    """Forget every recorded call. For tests."""
    with _lock:
        _hits.clear()
