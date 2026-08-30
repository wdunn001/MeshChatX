# SPDX-License-Identifier: 0BSD

"""ALTCHA proof-of-work verification for login and setup."""

from __future__ import annotations

import os
import threading
import time
from typing import Any

import altcha
from aiohttp import web

from meshchatx.src.env_utils import env_bool

ALTCHA_INVALID_CODE = "altcha_invalid"
ALTCHA_REPLAYED_CODE = "altcha_replayed"
ALTCHA_ALGORITHM = "PBKDF2/SHA-256"
ALTCHA_DEFAULT_COST = 2000

# A solved challenge is only good once. altcha.verify_solution is stateless:
# it checks the HMAC signature and the expiry embedded in the payload, but it
# never remembers that a particular solution was already accepted. Without
# something on this end, one solved payload could be replayed against sign
# up or sign in for as long as it stays unexpired (up to five minutes),
# which defeats the point of the proof of work. This is process local
# memory, which matches the single process aiohttp server this project
# runs; a multi process deployment would need a shared store instead.
_used_challenges: dict[str, float] = {}
_used_challenges_lock = threading.Lock()


def altcha_enabled_from_env() -> bool:
    return env_bool("MESHCHAT_ALTCHA_ENABLED", False)


def altcha_hmac_secret() -> str | None:
    raw = os.environ.get("MESHCHAT_ALTCHA_HMAC_KEY", "").strip()
    return raw or None


def altcha_configured() -> bool:
    return altcha_enabled_from_env() and bool(altcha_hmac_secret())


def altcha_pow_cost() -> int:
    raw = os.environ.get("MESHCHAT_ALTCHA_COST", "").strip()
    if not raw:
        return ALTCHA_DEFAULT_COST
    try:
        return max(100, int(raw))
    except ValueError:
        return ALTCHA_DEFAULT_COST


def create_altcha_challenge_dict() -> dict[str, Any]:
    secret = altcha_hmac_secret()
    if not secret:
        msg = "MESHCHAT_ALTCHA_HMAC_KEY is required when ALTCHA is enabled"
        raise RuntimeError(msg)
    expires_at = int(time.time()) + 300
    challenge = altcha.create_challenge(
        ALTCHA_ALGORITHM,
        altcha_pow_cost(),
        hmac_secret=secret,
        expires_at=expires_at,
    )
    return challenge.to_dict()


def _prune_used_challenges_locked(now: float) -> None:
    expired = [c for c, exp in _used_challenges.items() if exp <= now]
    for c in expired:
        del _used_challenges[c]


def _consume_challenge(challenge_id: str, expires_at: float | None) -> bool:
    """Record a solved challenge as spent.

    Returns False when this exact challenge was already accepted once
    before, which is what a replayed submission looks like.
    """
    now = time.time()
    # A missing or already past expiry still needs a bound, so a challenge
    # created without one does not linger in memory forever.
    ttl_at = expires_at if expires_at and expires_at > now else now + 300
    with _used_challenges_lock:
        _prune_used_challenges_locked(now)
        if challenge_id in _used_challenges:
            return False
        _used_challenges[challenge_id] = ttl_at
        return True


def reset_used_altcha_challenges() -> None:
    """Forget every recorded challenge. For tests."""
    with _used_challenges_lock:
        _used_challenges.clear()


def _challenge_identity(payload_str: str) -> tuple[str | None, float | None]:
    """The (id, expiry) a solved payload's challenge is tracked under.

    The challenge signature is unique per call to create_altcha_challenge_dict
    (it covers a random per-challenge nonce), so it doubles as a replay key:
    resubmitting the same solved payload always carries the same signature.
    """
    try:
        parsed = altcha.Payload.from_base64(payload_str)
        challenge = parsed.challenge
        signature = challenge.signature
        expires_at = challenge.parameters.expires_at
    except Exception:
        return None, None
    if not signature:
        return None, None
    return str(signature), float(expires_at) if expires_at else None


def verify_altcha_submission(payload: Any) -> tuple[bool, str | None]:
    secret = altcha_hmac_secret()
    if not secret:
        return False, "altcha_not_configured"
    if payload is None:
        return False, ALTCHA_INVALID_CODE
    if isinstance(payload, dict):
        import json

        payload = json.dumps(payload)
    if not isinstance(payload, str) or not payload.strip():
        return False, ALTCHA_INVALID_CODE
    payload = payload.strip()
    try:
        result = altcha.verify_solution(payload, secret)
    except Exception:
        return False, ALTCHA_INVALID_CODE
    if not result.verified:
        err = result.error or ALTCHA_INVALID_CODE
        return False, err

    challenge_id, expires_at = _challenge_identity(payload)
    if challenge_id is not None and not _consume_challenge(challenge_id, expires_at):
        return False, ALTCHA_REPLAYED_CODE

    return True, None


def altcha_error_response(code: str) -> web.Response:
    return web.json_response(
        {"error": "ALTCHA verification failed", "code": code},
        status=400,
    )


async def require_altcha_payload(request, data: dict) -> web.Response | None:
    if not altcha_enabled_from_env():
        return None
    payload = data.get("altcha")
    ok, code = verify_altcha_submission(payload)
    if not ok:
        return altcha_error_response(code or ALTCHA_INVALID_CODE)
    return None
