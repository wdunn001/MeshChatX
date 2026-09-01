# SPDX-License-Identifier: 0BSD

"""LXMF stamp (proof-of-work) verification for login and setup.

Replaces the ALTCHA PBKDF2 captcha that used to gate these same endpoints.
Rationale: this project already ships a proof-of-work system as part of
LXMF (LXStamper, used elsewhere to rate-limit message and propagation-node
delivery); shipping a second, unrelated PoW scheme for onboarding was
redundant, and a stamp is this network's native currency rather than a
bolted-on captcha.

The challenge is stateless and HMAC-signed, the same shape ALTCHA used:
the server picks the random material, cost, and expand_rounds, signs them,
and hands them to the client. The client solves the stamp (in a browser,
via the wasm build of rsLXMF's stamper) and submits it back together with
the untouched challenge fields; verification recomputes the signature so a
client can never lower its own difficulty or replay someone else's easier
challenge.

LXStamper's own stamp_valid() only checks the proof of work, never whether
a particular stamp has already been submitted, so a solved stamp could
otherwise be replayed against sign up or sign in for as long as its
challenge stays unexpired. The spent-stamp tracker below closes that gap,
exactly as _used_challenges did for ALTCHA before it. This is process
local memory, which matches the single process aiohttp server this project
runs; a multi process deployment would need a shared store instead.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time
from typing import Any

from aiohttp import web
from LXMF.LXStamper import stamp_valid, stamp_workblock

from meshchatx.src.env_utils import env_bool

STAMP_INVALID_CODE = "stamp_invalid"
STAMP_REPLAYED_CODE = "stamp_replayed"
STAMP_EXPIRED_CODE = "stamp_expired"

# Picked from a cross-implementation validation + timing pass done before
# this module was written: the Rust/wasm stamper (which the browser runs)
# hashes each candidate stamp against a cached mid-state rather than
# rehashing the whole workblock per attempt, so expand_rounds barely
# affects solve time in this implementation; only `cost` does. 25 matches
# LXMF's own STAMP_WORKBLOCK_EXPAND_ROUNDS_PEERING, an existing "cheap,
# lightweight admission check" constant. cost=17 lands a phone-class
# device in roughly one to a few seconds; see the stamp auth notes for the
# full measurement.
STAMP_DEFAULT_COST = 17
STAMP_DEFAULT_EXPAND_ROUNDS = 25

_MATERIAL_BYTES = 32
_CHALLENGE_TTL_SECONDS = 300

# A solved stamp is only good once. Keyed on (signature, stamp) so replaying
# the same solved payload against sign up or sign in a second time is
# rejected even though stamp_valid() would happily accept it again.
_used_stamps: dict[str, float] = {}
_used_stamps_lock = threading.Lock()


ENV_ENABLED = "MESHCHAT_STAMP_AUTH_ENABLED"
ENV_HMAC_KEY = "MESHCHAT_STAMP_AUTH_HMAC_KEY"
SETTINGS_HMAC_KEY = "stamp_auth_hmac_key"

# Resolved once at startup by configure_stamp_auth. Kept in the process
# because the challenge signing key has to be the same for the whole run of
# the server: a key that changed between handing out a challenge and reading
# the answer would reject every honest solution.
_runtime: dict[str, Any] = {"enabled": None, "secret": None}


def stamp_auth_enabled_from_env() -> bool:
    return env_bool(ENV_ENABLED, False)


def _env_enabled_explicitly() -> bool:
    """True when an operator set the switch themselves, either way."""
    return os.environ.get(ENV_ENABLED, "").strip() != ""


def _env_hmac_secret() -> str | None:
    raw = os.environ.get(ENV_HMAC_KEY, "").strip()
    return raw or None


def _stored_hmac_secret(storage_dir: str | None) -> str | None:
    """The signing key kept beside the other app security settings.

    Generated on first use so an operator does not have to invent one. A key
    that lives only in the environment is the reason a redeploy that drops
    one variable silently turns the whole gate off, which is exactly what this
    avoids.
    """
    if not storage_dir:
        return None
    from meshchatx.src.backend.app_security_settings import (
        load_app_security_settings,
        update_app_security_raw,
    )

    try:
        stored = load_app_security_settings(storage_dir).get(SETTINGS_HMAC_KEY)
    except Exception:
        stored = None
    if isinstance(stored, str) and stored.strip():
        return stored.strip()
    generated = os.urandom(32).hex()
    try:
        update_app_security_raw(storage_dir, {SETTINGS_HMAC_KEY: generated})
    except Exception:
        # A key that cannot be written is still usable for this run. The next
        # start generates another one, which only costs any challenge that was
        # outstanding across the restart.
        pass
    return generated


def configure_stamp_auth(
    storage_dir: str | None,
    *,
    multiuser_enabled: bool = False,
) -> bool:
    """Decide whether onboarding needs a stamp, and with which key.

    Sign up on a shared instance is open to anyone who can reach it, so the
    proof of work is the only thing standing between a script and an unbounded
    number of identities on someone else's machine. It is therefore on by
    default wherever accounts are in use, rather than waiting for an
    environment variable that a deployment can lose without anyone noticing.
    An operator who sets the variable gets what they asked for either way.
    """
    if _env_enabled_explicitly():
        enabled = stamp_auth_enabled_from_env()
    else:
        enabled = bool(multiuser_enabled)
    signing_key = _env_hmac_secret()
    if enabled and not signing_key:
        signing_key = _stored_hmac_secret(storage_dir)
    _runtime["enabled"] = bool(enabled and signing_key)
    _runtime["secret"] = signing_key
    return _runtime["enabled"]


def stamp_auth_enabled() -> bool:
    """True when a stamp is demanded on sign up and sign in.

    Falls back to the environment when configure_stamp_auth has not run, so
    importing this module in a test or a script behaves as it did before.
    """
    resolved = _runtime["enabled"]
    if resolved is None:
        return stamp_auth_enabled_from_env()
    return bool(resolved)


def stamp_auth_hmac_secret() -> str | None:
    if _runtime["secret"]:
        return _runtime["secret"]
    return _env_hmac_secret()


def reset_stamp_auth_configuration() -> None:
    """Forget what configure_stamp_auth resolved. For tests."""
    _runtime["enabled"] = None
    _runtime["secret"] = None


def stamp_auth_configured() -> bool:
    return stamp_auth_enabled() and bool(stamp_auth_hmac_secret())


def stamp_auth_cost() -> int:
    raw = os.environ.get("MESHCHAT_STAMP_AUTH_COST", "").strip()
    if not raw:
        return STAMP_DEFAULT_COST
    try:
        return max(1, min(64, int(raw)))
    except ValueError:
        return STAMP_DEFAULT_COST


def stamp_auth_expand_rounds() -> int:
    raw = os.environ.get("MESHCHAT_STAMP_AUTH_EXPAND_ROUNDS", "").strip()
    if not raw:
        return STAMP_DEFAULT_EXPAND_ROUNDS
    try:
        return max(1, int(raw))
    except ValueError:
        return STAMP_DEFAULT_EXPAND_ROUNDS


def _sign(
    material_hex: str,
    cost: int,
    expand_rounds: int,
    expires_at: int,
    secret: str,
) -> str:
    msg = f"{material_hex}:{cost}:{expand_rounds}:{expires_at}".encode()
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def create_stamp_challenge_dict() -> dict[str, Any]:
    secret = stamp_auth_hmac_secret()
    if not secret:
        msg = "MESHCHAT_STAMP_AUTH_HMAC_KEY is required when stamp auth is enabled"
        raise RuntimeError(msg)
    material_hex = os.urandom(_MATERIAL_BYTES).hex()
    cost = stamp_auth_cost()
    expand_rounds = stamp_auth_expand_rounds()
    expires_at = int(time.time()) + _CHALLENGE_TTL_SECONDS
    signature = _sign(material_hex, cost, expand_rounds, expires_at, secret)
    return {
        "material": material_hex,
        "cost": cost,
        "expand_rounds": expand_rounds,
        "expires_at": expires_at,
        "signature": signature,
    }


def _prune_used_stamps_locked(now: float) -> None:
    expired = [s for s, exp in _used_stamps.items() if exp <= now]
    for s in expired:
        del _used_stamps[s]


def _consume_stamp(signature: str, stamp_hex: str, expires_at: float) -> bool:
    """Record a solved stamp as spent.

    Returns False when this exact (challenge, stamp) pair was already
    accepted once before, which is what a replayed submission looks like.
    """
    now = time.time()
    key = f"{signature}:{stamp_hex}"
    ttl_at = (
        expires_at if expires_at and expires_at > now else now + _CHALLENGE_TTL_SECONDS
    )
    with _used_stamps_lock:
        _prune_used_stamps_locked(now)
        if key in _used_stamps:
            return False
        _used_stamps[key] = ttl_at
        return True


def reset_used_stamps() -> None:
    """Forget every recorded stamp. For tests."""
    with _used_stamps_lock:
        _used_stamps.clear()


def verify_stamp_submission(payload: Any) -> tuple[bool, str | None]:
    secret = stamp_auth_hmac_secret()
    if not secret:
        return False, "stamp_not_configured"
    if not isinstance(payload, dict):
        return False, STAMP_INVALID_CODE

    material_hex = payload.get("material")
    stamp_hex = payload.get("stamp")
    cost = payload.get("cost")
    expand_rounds = payload.get("expand_rounds")
    expires_at = payload.get("expires_at")
    signature = payload.get("signature")

    if not all(isinstance(v, str) and v for v in (material_hex, stamp_hex, signature)):
        return False, STAMP_INVALID_CODE
    if (
        not isinstance(cost, int)
        or isinstance(cost, bool)
        or not isinstance(expand_rounds, int)
        or isinstance(expand_rounds, bool)
        or not isinstance(expires_at, int)
        or isinstance(expires_at, bool)
    ):
        return False, STAMP_INVALID_CODE

    # The signature is what makes this stateless: it proves WE picked
    # material/cost/expand_rounds/expires_at, so a client cannot lower its
    # own difficulty or reuse a different, easier challenge.
    expected = _sign(material_hex, cost, expand_rounds, expires_at, secret)
    if not hmac.compare_digest(expected, signature):
        return False, STAMP_INVALID_CODE

    if expires_at < int(time.time()):
        return False, STAMP_EXPIRED_CODE

    try:
        material = bytes.fromhex(material_hex)
        stamp = bytes.fromhex(stamp_hex)
    except ValueError:
        return False, STAMP_INVALID_CODE
    if len(stamp) != 32:
        return False, STAMP_INVALID_CODE

    try:
        workblock = stamp_workblock(material, expand_rounds=expand_rounds)
        if not stamp_valid(stamp, cost, workblock):
            return False, STAMP_INVALID_CODE
    except Exception:
        return False, STAMP_INVALID_CODE

    if not _consume_stamp(signature, stamp_hex, expires_at):
        return False, STAMP_REPLAYED_CODE

    return True, None


def stamp_error_response(code: str) -> web.Response:
    return web.json_response(
        {"error": "Stamp verification failed", "code": code},
        status=400,
    )


async def require_stamp_payload(request, data: dict) -> web.Response | None:
    if not stamp_auth_enabled():
        return None
    payload = data.get("stamp_proof")
    ok, code = verify_stamp_submission(payload)
    if not ok:
        return stamp_error_response(code or STAMP_INVALID_CODE)
    return None
