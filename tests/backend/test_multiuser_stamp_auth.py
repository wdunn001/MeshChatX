# SPDX-License-Identifier: 0BSD

"""Oracle: an LXMF stamp gates the multi-user sign up and sign in routes.

Replaces test_multiuser_altcha.py now that these routes are gated by an
LXMF stamp (the proof of work this project's LXMF stack already carries)
instead of ALTCHA. Registration on a multi-user instance is deliberately
open to anyone who can reach it, so this is the primary defence against a
bot scripting its way through account creation, and a second layer against
a bot brute-forcing passwords on sign in.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer
from LXMF.LXStamper import generate_stamp

from meshchatx.src.backend.multiuser import rate_limit
from meshchatx.src.backend.stamp_auth import (
    STAMP_INVALID_CODE,
    STAMP_REPLAYED_CODE,
    create_stamp_challenge_dict,
    reset_stamp_auth_configuration,
    reset_used_stamps,
)
from tests.backend.conftest import fetch_api_csrf_headers
from tests.backend.demo_http_support import build_test_aio_app

_TEST_SECRET = "multiuser-test-secret-32chars-min!!"

_MULTIUSER_ENV = {"MESHCHAT_MULTIUSER": "1"}
# Low cost/expand_rounds so tests solve in milliseconds; see
# test_stamp_auth_oracle.py for the same choice and reasoning.
_STAMP_ENV = {
    **_MULTIUSER_ENV,
    "MESHCHAT_STAMP_AUTH_ENABLED": "1",
    "MESHCHAT_STAMP_AUTH_HMAC_KEY": _TEST_SECRET,
    "MESHCHAT_STAMP_AUTH_COST": "4",
    "MESHCHAT_STAMP_AUTH_EXPAND_ROUNDS": "5",
}


@pytest.fixture(autouse=True)
def _isolated_stamp_and_rate_limit_state():
    """Both are process-local module state. Tests must not see each other's."""
    reset_used_stamps()
    reset_stamp_auth_configuration()
    rate_limit.reset()
    yield
    reset_used_stamps()
    reset_stamp_auth_configuration()
    rate_limit.reset()


async def _build_multiuser_client(mock_app):
    """A running multi-user instance with a stubbed, conflict-free identity.

    Route registration reads MESHCHAT_MULTIUSER at build time, so it has to be
    set before build_test_aio_app runs, not just around individual requests.
    The mock identity class in the mock_app fixture hands back the same fixed
    hash for every RNS.Identity() call, which would collide across accounts
    in a test that registers more than one, and get_private_key() on it is
    not wired up for a real write to disk. Neither is what this test is
    about, so identity creation is stubbed to a distinct, well formed hash
    per call instead of exercising the real Reticulum identity/key path.
    """
    counter = {"n": 0}

    def _fake_create_identity(display_name=None):
        counter["n"] += 1
        return {"hash": "ab%030d" % counter["n"]}

    mock_app.identity_manager.create_identity = MagicMock(
        side_effect=_fake_create_identity,
    )
    with patch.dict(os.environ, _MULTIUSER_ENV, clear=False):
        aio_app = build_test_aio_app(mock_app)
    assert getattr(mock_app, "account_store", None) is not None
    return TestServer(aio_app)


def _solved_stamp_proof() -> dict:
    """A real, freshly solved stamp proof, signed under _TEST_SECRET."""
    with patch.dict(os.environ, _STAMP_ENV, clear=False):
        challenge = create_stamp_challenge_dict()
    material = bytes.fromhex(challenge["material"])
    stamp, _value = generate_stamp(material, challenge["cost"], challenge["expand_rounds"])
    assert stamp is not None
    return {**challenge, "stamp": stamp.hex()}


async def _register(client, headers, username="alice", password="correct-horse", stamp_proof=None):
    body = {"username": username, "password": password}
    if stamp_proof is not None:
        body["stamp_proof"] = stamp_proof
    return await client.post("/api/v1/multiuser/register", json=body, headers=headers)


async def _login(client, headers, username="alice", password="correct-horse", stamp_proof=None):
    body = {"username": username, "password": password}
    if stamp_proof is not None:
        body["stamp_proof"] = stamp_proof
    return await client.post("/api/v1/multiuser/login", json=body, headers=headers)


async def _account_count(client, headers) -> int:
    response = await client.get("/api/v1/multiuser/status")
    assert response.status == 200
    data = await response.json()
    return data["accounts"]


# --- Registration ------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_rejected_without_stamp_when_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _STAMP_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            response = await _register(client, headers)
            assert response.status == 400
            body = await response.json()
            assert body.get("code") == STAMP_INVALID_CODE
            assert await _account_count(client, headers) == 0


@pytest.mark.asyncio
async def test_register_rejected_with_tampered_stamp_when_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _STAMP_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            proof = _solved_stamp_proof()
            proof["cost"] = 1  # claim an easier challenge than was signed
            response = await _register(client, headers, stamp_proof=proof)
            assert response.status == 400
            body = await response.json()
            assert body.get("code") not in (None, "")
            assert await _account_count(client, headers) == 0


@pytest.mark.asyncio
async def test_register_succeeds_with_valid_stamp(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _STAMP_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            proof = _solved_stamp_proof()
            response = await _register(client, headers, stamp_proof=proof)
            assert response.status == 200
            body = await response.json()
            assert body.get("message") == "Welcome"
            assert await _account_count(client, headers) == 1


@pytest.mark.asyncio
async def test_register_does_not_require_stamp_when_not_configured(mock_app):
    """No MESHCHAT_STAMP_AUTH_* env set: single-user and dev installs are unaffected."""
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        headers = await fetch_api_csrf_headers(client)
        response = await _register(client, headers)
        assert response.status == 200
        body = await response.json()
        assert body.get("message") == "Welcome"


@pytest.mark.asyncio
async def test_register_replayed_stamp_is_rejected(mock_app):
    """A solved stamp is good for exactly one account, not two."""
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _STAMP_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            proof = _solved_stamp_proof()

            first = await _register(client, headers, username="alice", stamp_proof=proof)
            assert first.status == 200

            second = await _register(client, headers, username="mallory", stamp_proof=proof)
            assert second.status == 400
            body = await second.json()
            assert body.get("code") == STAMP_REPLAYED_CODE

            assert await _account_count(client, headers) == 1


# --- Sign in -------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_rejected_without_stamp_when_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _STAMP_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            response = await _login(client, headers, username="nobody")
            assert response.status == 400
            body = await response.json()
            assert body.get("code") == STAMP_INVALID_CODE


@pytest.mark.asyncio
async def test_login_does_not_require_stamp_when_not_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        headers = await fetch_api_csrf_headers(client)
        response = await _login(client, headers, username="nobody")
        # Gets past the stamp gate (a no-op here) and fails on credentials,
        # rather than being blocked at 400 for a missing solution.
        assert response.status == 401


@pytest.mark.asyncio
async def test_login_replayed_stamp_is_rejected_before_credentials(mock_app):
    """A solved stamp used once for sign in cannot be reused for another attempt.

    Uses an unknown username on purpose: the first call is expected to reach
    (and fail) the password check, which is what proves the valid solution
    was accepted rather than short-circuited. The point under test is that
    the second call, reusing the same solution, never gets that far.
    """
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _STAMP_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            proof = _solved_stamp_proof()

            first = await _login(client, headers, username="nobody", stamp_proof=proof)
            assert first.status == 401
            first_body = await first.json()
            assert "code" not in first_body

            second = await _login(client, headers, username="nobody", stamp_proof=proof)
            assert second.status == 400
            second_body = await second.json()
            assert second_body.get("code") == STAMP_REPLAYED_CODE
