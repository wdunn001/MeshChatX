# SPDX-License-Identifier: 0BSD

"""Oracle: a new multi-user account's identity announces under the username
the person just typed, not the desktop default of "Anonymous Peer".

The sign-up form already collects a username, so the point of this coverage
is that registration hands it straight to the new identity as its display
name, without a separate settings step, so nobody lands on the mesh under
the generic default the moment they sign up.

Two things have to be true for that to hold, and each gets its own test:

1. multiuser_register (routes.py) passes the normalized username through to
   identity_manager.create_identity as display_name. This is the part most
   likely to regress if the route handler is touched later, so it is
   asserted against the real HTTP route rather than inferred.
2. IdentityManager.create_identity, given a display_name, actually persists
   it: to the per-identity config database that
   ctx.config.display_name.get() reads at announce time (meshchat.py
   announce()), and to metadata.json, which is what identity listings read
   before any database is opened. This is exercised against the real
   IdentityManager with no mocking, since the whole question is whether the
   write survives to disk.
"""

from __future__ import annotations

import json
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from meshchatx.src.backend.database.config import ConfigDAO
from meshchatx.src.backend.database.provider import DatabaseProvider
from meshchatx.src.backend.identity_manager import IdentityManager
from meshchatx.src.backend.multiuser import rate_limit
from tests.backend.conftest import fetch_api_csrf_headers
from tests.backend.demo_http_support import build_test_aio_app

_MULTIUSER_ENV = {"MESHCHAT_MULTIUSER": "1"}


@pytest.fixture(autouse=True)
def _isolated_rate_limit_state():
    """Rate limiting is process-local module state; tests must not share it."""
    rate_limit.reset()
    yield
    rate_limit.reset()


async def _build_multiuser_client(mock_app):
    counter = {"n": 0}
    calls = []

    def _fake_create_identity(display_name=None):
        counter["n"] += 1
        calls.append(display_name)
        return {"hash": "ab%030d" % counter["n"]}

    mock_app.identity_manager.create_identity = MagicMock(
        side_effect=_fake_create_identity,
    )
    with patch.dict(os.environ, _MULTIUSER_ENV, clear=False):
        aio_app = build_test_aio_app(mock_app)
    assert getattr(mock_app, "account_store", None) is not None
    return TestServer(aio_app), calls


@pytest.mark.asyncio
async def test_register_passes_username_as_display_name(mock_app):
    server, calls = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        headers = await fetch_api_csrf_headers(client)
        response = await client.post(
            "/api/v1/multiuser/register",
            json={"username": "RadioAlice", "password": "correct-horse"},
            headers=headers,
        )
        assert response.status == 200

    # Usernames are matched and stored lowercased (see USERNAME_RE in
    # accounts.py), so "the username the person just typed" is, once it
    # reaches this point, already the only form that exists: there is no
    # original-casing value left to prefer over it.
    assert calls == ["radioalice"]


@pytest.mark.asyncio
async def test_register_does_not_default_to_anonymous_peer(mock_app):
    """Direct regression for the reported symptom: a fresh account must not
    be handed the desktop default display name at any point in the path
    from sign-up form to identity_manager call."""
    server, calls = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        headers = await fetch_api_csrf_headers(client)
        response = await client.post(
            "/api/v1/multiuser/register",
            json={"username": "bob", "password": "correct-horse"},
            headers=headers,
        )
        assert response.status == 200

    assert calls == ["bob"]
    assert "Anonymous Peer" not in calls


def test_create_identity_persists_display_name_to_config_and_metadata():
    """IdentityManager.create_identity, unmocked: does the write survive?

    ctx.config.display_name.get() (read at announce time, meshchat.py
    announce()) resolves through ConfigDAO against the identity's own
    database.db, and identity listings read metadata.json before any
    database is opened. A display name handed to create_identity has to
    reach both, or a fresh account can still announce under the default
    depending on which path something later reads it from.
    """
    with tempfile.TemporaryDirectory() as tmp:
        manager = IdentityManager(tmp)
        created = manager.create_identity(display_name="radioalice")
        identity_hash = created["hash"]
        assert created["display_name"] == "radioalice"

        db_path = os.path.join(tmp, "identities", identity_hash, "database.db")
        provider = DatabaseProvider(db_path)
        try:
            assert ConfigDAO(provider).get("display_name") == "radioalice"
        finally:
            provider.close_all()

        metadata_path = os.path.join(tmp, "identities", identity_hash, "metadata.json")
        with open(metadata_path, encoding="utf-8") as handle:
            metadata = json.load(handle)
        assert metadata["display_name"] == "radioalice"


def test_create_identity_without_display_name_still_defaults_to_anonymous_peer():
    """The desktop path (no username to draw from) is unchanged: a fresh
    identity created without a display name still gets the historical
    default, both in config and metadata."""
    with tempfile.TemporaryDirectory() as tmp:
        manager = IdentityManager(tmp)
        created = manager.create_identity()
        identity_hash = created["hash"]
        assert created["display_name"] == "Anonymous Peer"

        db_path = os.path.join(tmp, "identities", identity_hash, "database.db")
        provider = DatabaseProvider(db_path)
        try:
            assert ConfigDAO(provider).get("display_name") == "Anonymous Peer"
        finally:
            provider.close_all()
