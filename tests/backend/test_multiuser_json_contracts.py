# SPDX-License-Identifier: 0BSD

"""JSON shapes of the account routes, pinned where those routes exist.

The broad contract sweep in test_http_api_json_contracts_broad.py builds a
single user app, so the multi-user routes are not registered there and it
excludes them. They still carry the two fields the whole authorization model
turns on, a role and an identity hash, so the shapes are pinned here against an
app that really is running in accounts mode.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from meshchatx.src.backend.multiuser import rate_limit
from meshchatx.src.backend.stamp_auth import (
    reset_stamp_auth_configuration,
    reset_used_stamps,
)
from tests.backend.api_json_contract_schemas import assert_matches_schema
from tests.backend.conftest import fetch_api_csrf_headers
from tests.backend.demo_http_support import build_test_aio_app

# Stamp auth off, so these tests are about response shape and not proof of
# work. test_multiuser_stamp_auth.py owns the gate itself.
_MULTIUSER_ENV = {"MESHCHAT_MULTIUSER": "1", "MESHCHAT_STAMP_AUTH_ENABLED": "0"}

_ACCOUNT_SCHEMA = {
    "type": "object",
    "required": ["username", "role", "identity_hash"],
    "properties": {
        "username": {"type": "string", "minLength": 1},
        "role": {"type": "string", "enum": ["user", "contributor", "admin"]},
        "identity_hash": {"type": "string", "minLength": 1},
    },
}

MULTIUSER_STATUS_SCHEMA = {
    "type": "object",
    "required": ["enabled", "accounts", "registration_open", "signed_in", "account"],
    "properties": {
        "enabled": {"type": "boolean"},
        "accounts": {"type": "integer", "minimum": 0},
        "registration_open": {"type": "boolean"},
        "signed_in": {"type": "boolean"},
        "account": {"anyOf": [_ACCOUNT_SCHEMA, {"type": "null"}]},
    },
}

MULTIUSER_ME_SCHEMA = {
    "type": "object",
    "required": ["account"],
    "properties": {"account": _ACCOUNT_SCHEMA},
}

MULTIUSER_ACCOUNTS_SCHEMA = {
    "type": "object",
    "required": ["accounts"],
    "properties": {
        "accounts": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "id",
                    "username",
                    "role",
                    "enabled",
                    "identity_hash",
                    "last_login_at",
                ],
                "properties": {
                    "id": {"type": "integer"},
                    "username": {"type": "string", "minLength": 1},
                    "role": {"type": "string", "enum": ["user", "contributor", "admin"]},
                    "enabled": {"type": "boolean"},
                    "identity_hash": {"type": "string", "minLength": 1},
                    "last_login_at": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                },
            },
        },
    },
}

MULTIUSER_REGISTRATION_SCHEMA = {
    "type": "object",
    "required": ["registration_open"],
    "properties": {"registration_open": {"type": "boolean"}},
}


@pytest.fixture(autouse=True)
def _isolated_process_state():
    reset_used_stamps()
    reset_stamp_auth_configuration()
    rate_limit.reset()
    yield
    reset_used_stamps()
    reset_stamp_auth_configuration()
    rate_limit.reset()


async def _build_multiuser_client(mock_app):
    """A running accounts-mode instance with a conflict-free stub identity.

    Route registration reads MESHCHAT_MULTIUSER when the app is built, so the
    variable has to be set around build_test_aio_app rather than around the
    individual requests. Identity creation is stubbed because the mock identity
    hands back one fixed hash for every call, which collides the moment a test
    registers a second account.
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


async def _register(client, headers, username, password="correct-horse"):
    return await client.post(
        "/api/v1/multiuser/register",
        json={"username": username, "password": password},
        headers=headers,
    )


@pytest.mark.asyncio
async def test_status_shape_before_and_after_signing_in(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _MULTIUSER_ENV, clear=False):
            response = await client.get("/api/v1/multiuser/status")
            assert response.status == 200
            body = await response.json()
            assert_matches_schema(body, MULTIUSER_STATUS_SCHEMA)
            assert body["signed_in"] is False
            assert body["account"] is None

            headers = await fetch_api_csrf_headers(client)
            assert (await _register(client, headers, "alice")).status == 200

            response = await client.get("/api/v1/multiuser/status")
            body = await response.json()
            assert_matches_schema(body, MULTIUSER_STATUS_SCHEMA)
            assert body["signed_in"] is True
            # The first account is admin whatever role was asked for, because
            # an instance with no admin cannot be administered.
            assert body["account"]["role"] == "admin"


@pytest.mark.asyncio
async def test_me_answers_401_until_signed_in_then_names_the_account(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _MULTIUSER_ENV, clear=False):
            assert (await client.get("/api/v1/multiuser/me")).status == 401

            headers = await fetch_api_csrf_headers(client)
            assert (await _register(client, headers, "alice")).status == 200

            response = await client.get("/api/v1/multiuser/me")
            assert response.status == 200
            assert_matches_schema(await response.json(), MULTIUSER_ME_SCHEMA)


@pytest.mark.asyncio
async def test_accounts_list_shape_carries_role_and_last_login(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _MULTIUSER_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            assert (await _register(client, headers, "alice")).status == 200

            response = await client.get("/api/v1/multiuser/accounts")
            assert response.status == 200
            body = await response.json()
            assert_matches_schema(body, MULTIUSER_ACCOUNTS_SCHEMA)
            assert [row["username"] for row in body["accounts"]] == ["alice"]
            # Never signed in through the login route, so this stays null
            # rather than becoming a timestamp of the sign up.
            assert body["accounts"][0]["last_login_at"] is None


@pytest.mark.asyncio
async def test_registration_shape_and_that_it_can_be_closed(mock_app):
    server = await _build_multiuser_client(mock_app)
    async with TestClient(server) as client:
        with patch.dict(os.environ, _MULTIUSER_ENV, clear=False):
            headers = await fetch_api_csrf_headers(client)
            assert (await _register(client, headers, "alice")).status == 200

            response = await client.get("/api/v1/multiuser/registration")
            assert response.status == 200
            body = await response.json()
            assert_matches_schema(body, MULTIUSER_REGISTRATION_SCHEMA)
            assert body["registration_open"] is True

            headers = await fetch_api_csrf_headers(client)
            response = await client.patch(
                "/api/v1/multiuser/registration",
                json={"registration_open": False},
                headers=headers,
            )
            assert response.status == 200
            assert_matches_schema(await response.json(), MULTIUSER_REGISTRATION_SCHEMA)

            body = await (await client.get("/api/v1/multiuser/registration")).json()
            assert body["registration_open"] is False

            # A closed instance refuses the next sign up rather than quietly
            # accepting it.
            headers = await fetch_api_csrf_headers(client)
            assert (await _register(client, headers, "bob")).status == 403
