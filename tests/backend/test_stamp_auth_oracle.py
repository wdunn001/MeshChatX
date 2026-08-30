# SPDX-License-Identifier: 0BSD

"""Oracle: LXMF stamp challenge round-trip and login rejection without payload.

Replaces test_altcha_oracle.py now that sign up and sign in are gated by an
LXMF stamp (proof of work already carried by this project's LXMF stack)
instead of ALTCHA.
"""

from __future__ import annotations

import os
import time
from unittest.mock import patch

import bcrypt
import pytest
from aiohttp.test_utils import TestClient, TestServer
from LXMF.LXStamper import generate_stamp

from meshchatx.src.backend.stamp_auth import (
    STAMP_INVALID_CODE,
    create_stamp_challenge_dict,
    verify_stamp_submission,
)
from tests.backend.conftest import fetch_api_csrf_headers
from tests.backend.demo_http_support import build_test_aio_app

_TEST_SECRET = "test-secret-key-32chars-minimum!!"

# Low cost/expand_rounds so tests solve in milliseconds. Operators tune the
# real values with MESHCHAT_STAMP_AUTH_COST / MESHCHAT_STAMP_AUTH_EXPAND_ROUNDS;
# these tests exercise the exact same code path with faster settings.
_FAST_STAMP_ENV = {
    "MESHCHAT_STAMP_AUTH_ENABLED": "1",
    "MESHCHAT_STAMP_AUTH_HMAC_KEY": _TEST_SECRET,
    "MESHCHAT_STAMP_AUTH_COST": "4",
    "MESHCHAT_STAMP_AUTH_EXPAND_ROUNDS": "5",
}


def _solve_challenge(challenge: dict) -> dict:
    material = bytes.fromhex(challenge["material"])
    stamp, _value = generate_stamp(material, challenge["cost"], challenge["expand_rounds"])
    assert stamp is not None
    return {**challenge, "stamp": stamp.hex()}


def test_stamp_verify_round_trip():
    with patch.dict(os.environ, _FAST_STAMP_ENV, clear=False):
        challenge = create_stamp_challenge_dict()
        solved = _solve_challenge(challenge)
        ok, code = verify_stamp_submission(solved)
        assert ok is True
        assert code is None


def test_stamp_rejects_tampered_payload():
    with patch.dict(os.environ, _FAST_STAMP_ENV, clear=False):
        challenge = create_stamp_challenge_dict()
        solved = _solve_challenge(challenge)
        solved["cost"] = 1  # claim an easier challenge than was actually signed
        ok, code = verify_stamp_submission(solved)
        assert ok is False
        assert code == STAMP_INVALID_CODE


def test_stamp_rejects_unsolved_payload():
    # verification cost is O(1) regardless of the target cost (it is a
    # single hash comparison, not a search), so a high cost here is free and
    # makes an arbitrary unsolved stamp fail deterministically rather than
    # with a ~1-in-16 chance of accidentally clearing a low bar.
    env = {**_FAST_STAMP_ENV, "MESHCHAT_STAMP_AUTH_COST": "24"}
    with patch.dict(os.environ, env, clear=False):
        challenge = create_stamp_challenge_dict()
        unsolved = {**challenge, "stamp": "00" * 32}
        ok, code = verify_stamp_submission(unsolved)
        assert ok is False
        assert code == STAMP_INVALID_CODE


@pytest.mark.asyncio
async def test_login_without_stamp_when_enabled(mock_app):
    mock_app.stamp_auth_enabled = True
    mock_app.demo_mode = False
    mock_app.current_context.running = True
    mock_app.config.auth_enabled.set(True)
    password_hash = bcrypt.hashpw(b"secretpass", bcrypt.gensalt()).decode("utf-8")
    mock_app.config.auth_password_hash.set(password_hash)

    aio_app = build_test_aio_app(mock_app)
    async with TestClient(TestServer(aio_app)) as client:
        with patch.dict(os.environ, _FAST_STAMP_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            response = await client.post(
                "/api/v1/auth/login",
                json={"password": "secretpass"},
                headers=headers,
            )
            assert response.status == 400
            body = await response.json()
            assert body.get("code") == STAMP_INVALID_CODE


@pytest.mark.asyncio
async def test_stamp_challenge_endpoint(mock_app):
    mock_app.stamp_auth_enabled = True
    mock_app.current_context.running = True
    aio_app = build_test_aio_app(mock_app)
    async with TestClient(TestServer(aio_app)) as client:
        with patch.dict(os.environ, _FAST_STAMP_ENV, clear=False):
            response = await client.get("/api/v1/auth/stamp/challenge")
            assert response.status == 200
            data = await response.json()
            assert "material" in data
            assert "signature" in data
            assert data.get("cost") == 4
            assert data.get("expand_rounds") == 5


@pytest.mark.asyncio
async def test_stamp_challenge_endpoint_404_when_disabled(mock_app):
    mock_app.stamp_auth_enabled = False
    mock_app.current_context.running = True
    aio_app = build_test_aio_app(mock_app)
    async with TestClient(TestServer(aio_app)) as client:
        response = await client.get("/api/v1/auth/stamp/challenge")
        assert response.status == 404


def test_stamp_challenge_expiry_is_bounded():
    with patch.dict(os.environ, _FAST_STAMP_ENV, clear=False):
        challenge = create_stamp_challenge_dict()
        assert challenge["expires_at"] > int(time.time())
        assert challenge["expires_at"] <= int(time.time()) + 301
