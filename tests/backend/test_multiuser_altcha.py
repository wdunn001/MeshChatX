# SPDX-License-Identifier: 0BSD

"""Oracle: ALTCHA proof of work gates the multi-user sign up and sign in routes.

Registration on a multi-user instance is deliberately open to anyone who can
reach it, so ALTCHA is the primary defence against a bot scripting its way
through account creation, and a second layer against a bot brute-forcing
passwords on sign in. These tests exist because that enforcement did not
exist at all before it was wired into
meshchatx/src/backend/multiuser/routes.py: the challenge endpoint worked,
verify_altcha_submission() worked, but nothing on the multi-user account
routes ever called it, so turning the feature on gated nothing.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from meshchatx.src.backend.altcha_auth import (
    ALTCHA_INVALID_CODE,
    ALTCHA_REPLAYED_CODE,
    reset_used_altcha_challenges,
    verify_altcha_submission,
)
from meshchatx.src.backend.multiuser import rate_limit
from tests.backend.conftest import fetch_api_csrf_headers
from tests.backend.demo_http_support import build_test_aio_app
from tests.backend.test_altcha_oracle import _solved_payload_b64

_TEST_SECRET = "multiuser-test-secret-32chars-min!!"

_MULTIUSER_ENV = {"MESHCHAT_MULTIUSER": "1"}
_ALTCHA_ENV = {
    **_MULTIUSER_ENV,
    "MESHCHAT_ALTCHA_ENABLED": "1",
    "MESHCHAT_ALTCHA_HMAC_KEY": _TEST_SECRET,
}


@pytest.fixture(autouse=True)
def _isolated_altcha_and_rate_limit_state():
    """Both are process-local module state. Tests must not see each other's."""
    reset_used_altcha_challenges()
    rate_limit.reset()
    yield
    reset_used_altcha_challenges()
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


async def _register(client, headers, username="alice", password="correct-horse", altcha=None):
    body = {"username": username, "password": password}
    if altcha is not None:
        body["altcha"] = altcha
    return await client.post("/api/v1/multiuser/register", json=body, headers=headers)


async def _login(client, headers, username="alice", password="correct-horse", altcha=None):
    body = {"username": username, "password": password}
    if altcha is not None:
        body["altcha"] = altcha
    return await client.post("/api/v1/multiuser/login", json=body, headers=headers)


async def _account_count(client, headers) -> int:
    response = await client.get("/api/v1/multiuser/status")
    assert response.status == 200
    data = await response.json()
    return data["accounts"]


# --- Unit level: replay protection lives in altcha_auth itself -------------


def test_altcha_verify_rejects_replayed_payload():
    with patch.dict(os.environ, {"MESHCHAT_ALTCHA_HMAC_KEY": _TEST_SECRET}, clear=False):
        payload = _solved_payload_b64(_TEST_SECRET)

        first_ok, first_code = verify_altcha_submission(payload)
        assert first_ok is True
        assert first_code is None

        second_ok, second_code = verify_altcha_submission(payload)
        assert second_ok is False
        assert second_code == ALTCHA_REPLAYED_CODE


# --- Registration ------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_rejected_without_altcha_when_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _ALTCHA_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            response = await _register(client, headers)
            assert response.status == 400
            body = await response.json()
            assert body.get("code") == ALTCHA_INVALID_CODE
            assert await _account_count(client, headers) == 0


@pytest.mark.asyncio
async def test_register_rejected_with_tampered_altcha_when_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _ALTCHA_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            bad_solution = _solved_payload_b64(_TEST_SECRET)[:-4] + "XXXX"
            response = await _register(client, headers, altcha=bad_solution)
            assert response.status == 400
            body = await response.json()
            assert body.get("code") not in (None, "")
            assert await _account_count(client, headers) == 0


@pytest.mark.asyncio
async def test_register_succeeds_with_valid_altcha_solution(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _ALTCHA_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            solved = _solved_payload_b64(_TEST_SECRET)
            response = await _register(client, headers, altcha=solved)
            assert response.status == 200
            body = await response.json()
            assert body.get("message") == "Welcome"
            assert await _account_count(client, headers) == 1


@pytest.mark.asyncio
async def test_register_does_not_require_altcha_when_not_configured(mock_app):
    """No MESHCHAT_ALTCHA_* env set: single-user and dev installs are unaffected."""
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        headers = await fetch_api_csrf_headers(client)
        response = await _register(client, headers)
        assert response.status == 200
        body = await response.json()
        assert body.get("message") == "Welcome"


@pytest.mark.asyncio
async def test_register_replayed_altcha_solution_is_rejected(mock_app):
    """A solved challenge is good for exactly one account, not two."""
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _ALTCHA_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            solved = _solved_payload_b64(_TEST_SECRET)

            first = await _register(client, headers, username="alice", altcha=solved)
            assert first.status == 200

            second = await _register(client, headers, username="mallory", altcha=solved)
            assert second.status == 400
            body = await second.json()
            assert body.get("code") == ALTCHA_REPLAYED_CODE

            assert await _account_count(client, headers) == 1


# --- Sign in -------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_rejected_without_altcha_when_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _ALTCHA_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            response = await _login(client, headers, username="nobody")
            assert response.status == 400
            body = await response.json()
            assert body.get("code") == ALTCHA_INVALID_CODE


@pytest.mark.asyncio
async def test_login_does_not_require_altcha_when_not_configured(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        headers = await fetch_api_csrf_headers(client)
        response = await _login(client, headers, username="nobody")
        # Gets past the ALTCHA gate (a no-op here) and fails on credentials,
        # rather than being blocked at 400 for a missing solution.
        assert response.status == 401


@pytest.mark.asyncio
async def test_login_replayed_altcha_solution_is_rejected_before_credentials(mock_app):
    """A solved challenge used once for sign in cannot be reused for another attempt.

    Uses an unknown username on purpose: the first call is expected to reach
    (and fail) the password check, which is what proves the valid solution
    was accepted rather than short-circuited. The point under test is that
    the second call, reusing the same solution, never gets that far.
    """
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _ALTCHA_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            solved = _solved_payload_b64(_TEST_SECRET)

            first = await _login(client, headers, username="nobody", altcha=solved)
            assert first.status == 401
            first_body = await first.json()
            assert "code" not in first_body

            second = await _login(client, headers, username="nobody", altcha=solved)
            assert second.status == 400
            second_body = await second.json()
            assert second_body.get("code") == ALTCHA_REPLAYED_CODE
