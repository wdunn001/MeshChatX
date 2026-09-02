# SPDX-License-Identifier: 0BSD

"""Oracle: /api/v1/status on a multi-user instance.

This instance runs its network stack independently of any browser session:
RNS and the Mesh interfaces come up on their own and keep running whether
or not anyone is signed in. The frontend boot gate polls /api/v1/status to
learn the app is up before it mounts, but the multi-user permissions table
used to require a session for that path, so an unauthenticated caller (the
only kind that exists before the shell has mounted) got
{"error": "Sign in to use this instance"} back with a 401. The frontend
read that as "still starting" and polled it for two minutes before giving
up with "Network startup timed out." even though the backend was healthy
the entire time.

These tests are the backend half of the regression coverage. An
unauthenticated GET must succeed and hand back enough for the boot gate to
proceed, without leaking anything gated: no listen host or port, no HTTPS
or plugin configuration, no landlock/sandbox detail. A signed-in GET keeps
getting the full payload exactly as before, so nothing already relying on
it loses a field.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from meshchatx.src.backend.multiuser import rate_limit
from tests.backend.conftest import fetch_api_csrf_headers
from tests.backend.demo_http_support import build_test_aio_app

_MULTIUSER_ENV = {"MESHCHAT_MULTIUSER": "1"}

# The full payload's config/detail keys. None of these may appear in the
# unauthenticated response; every one of them is present in the signed-in
# response, which is how the test proves the split is real rather than the
# handler happening to omit fields it never set.
_GATED_KEYS = (
    "listen_host",
    "listen_port",
    "https_enabled",
    "is_loopback_bind",
    "plugins_enabled",
    "demo_mode",
    "stamp_auth_enabled",
    "auth_page_hint",
    "landlock_kernel_supported",
    "landlock_active",
    "appcontainer_active",
    "seccomp_kernel_supported",
)

# What an unauthenticated caller needs and nothing more: whether the app is
# up, at what stage, and whether the UI may mount.
_READINESS_KEYS = {"status", "stage", "network_ready", "network_degraded", "ui_ready"}


@pytest.fixture(autouse=True)
def _isolated_rate_limit_state():
    """Rate limiting is process-local module state; tests must not share it."""
    rate_limit.reset()
    yield
    rate_limit.reset()


async def _build_multiuser_client(mock_app):
    """A running multi-user instance with the real multiuser middleware wired in.

    build_test_aio_app on its own only adds the six middlewares _define_routes
    returns (auth, mime_type, security, csrf, ip_allowlist, demo_mode); the
    multiuser middleware is assembled separately in the real server startup
    path and is not part of that tuple. Added here at the same position
    production uses it (immediately after auth_middleware, see meshchat.py's
    app.middlewares.extend(...) ordering comment), so these tests exercise the
    actual session-to-context binding that decides what status.py sees,
    rather than only the route in isolation.
    """
    from meshchatx.src.backend.multiuser.middleware import create_multiuser_middleware

    counter = {"n": 0}

    def _fake_create_identity(display_name=None):
        counter["n"] += 1
        return {"hash": "ab%030d" % counter["n"]}

    mock_app.identity_manager.create_identity = MagicMock(
        side_effect=_fake_create_identity,
    )
    with patch.dict(os.environ, _MULTIUSER_ENV, clear=False):
        aio_app = build_test_aio_app(mock_app)
        aio_app.middlewares.insert(1, create_multiuser_middleware(mock_app))
    assert getattr(mock_app, "account_store", None) is not None
    return TestServer(aio_app)


@pytest.mark.asyncio
async def test_unauthenticated_status_is_200_not_401(mock_app):
    """The exact regression.

    This used to be a 401, and the frontend never recovered from that on its
    own.
    """
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        response = await client.get("/api/v1/status")
        assert response.status == 200
        body = await response.json()
        assert "error" not in body or body.get("status") == "failed"
        assert body.get("status") in ("ok", "starting")


@pytest.mark.asyncio
async def test_unauthenticated_status_leaks_no_gated_fields(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        response = await client.get("/api/v1/status")
        assert response.status == 200
        body = await response.json()
        leaked = [key for key in _GATED_KEYS if key in body]
        assert leaked == [], f"unauthenticated /api/v1/status leaked: {leaked}"
        assert _READINESS_KEYS.issubset(body.keys())


@pytest.mark.asyncio
async def test_authenticated_status_still_gets_full_payload(mock_app):
    """Signing in must not lose anything the route already handed back.

    The identity manager is stubbed for registration (see
    _build_multiuser_client), so it returns an account hash with no
    identity file behind it on disk. That is enough for the account to
    exist, but resolve_context's normal path would fail to load it, which
    is not what this test is about. app.contexts is seeded directly with a
    stand-in "running" context under that hash instead, the same fast path
    resolve_context itself takes for any context it already has cached, so
    the request goes through the real middleware and the real route with a
    context genuinely bound, exercising the get_active_context() branch in
    status.py rather than a shortcut around it.
    """
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        anon_response = await client.get("/api/v1/status")
        assert anon_response.status == 200
        anon_body = await anon_response.json()

        headers = await fetch_api_csrf_headers(client)
        register = await client.post(
            "/api/v1/multiuser/register",
            json={"username": "alice", "password": "correct-horse-battery"},
            headers=headers,
        )
        assert register.status == 200
        register_body = await register.json()
        identity_hash = register_body["account"]["identity_hash"]

        mock_app.contexts[identity_hash] = MagicMock(running=True)

        auth_response = await client.get("/api/v1/status")
        assert auth_response.status == 200
        auth_body = await auth_response.json()

        for key in _GATED_KEYS:
            assert key in auth_body, f"signed-in /api/v1/status is missing: {key}"
        assert auth_body["listen_host"] == mock_app.listen_host
        assert auth_body["listen_port"] == mock_app.listen_port
        # The unauthenticated body proven minimal here too, diffed against
        # the signed-in one to show the split is real: more comes back once
        # there is a session, not less.
        assert set(anon_body.keys()) <= _READINESS_KEYS | {"error"}
        assert set(auth_body.keys()) > set(anon_body.keys())
        assert not any(key in anon_body for key in _GATED_KEYS)


@pytest.mark.asyncio
async def test_single_user_status_unchanged(mock_app):
    """Unchanged behaviour without MESHCHAT_MULTIUSER.

    The historical always-public, full-payload behaviour is untouched.
    """
    aio_app = build_test_aio_app(mock_app)
    server = TestServer(aio_app)
    async with TestClient(server) as client:
        response = await client.get("/api/v1/status")
        assert response.status == 200
        body = await response.json()
        for key in _GATED_KEYS:
            assert key in body, f"single-user /api/v1/status is missing: {key}"
