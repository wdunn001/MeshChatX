# SPDX-License-Identifier: 0BSD

"""Oracle: the per identity store behind the browser preferences.

A shared terminal's localStorage belongs to the machine. These preferences are
held here instead so they follow the person rather than the browser, which is
what lets the browser be cleared on the way in and on the way out.
"""

from __future__ import annotations

import json

import pytest
from aiohttp.test_utils import TestClient, TestServer

from tests.backend.conftest import fetch_api_csrf_headers
from tests.backend.demo_http_support import build_test_aio_app


@pytest.fixture
async def client(mock_app):
    server = TestServer(build_test_aio_app(mock_app))
    async with TestClient(server) as test_client:
        yield test_client


@pytest.mark.asyncio
async def test_a_fresh_identity_has_an_empty_profile(client):
    response = await client.get("/api/v1/app/ui-profile")
    assert response.status == 200
    assert await response.json() == {"profile": {}}


@pytest.mark.asyncio
async def test_a_stored_profile_comes_back_unchanged(client):
    headers = await fetch_api_csrf_headers(client)
    profile = {
        "meshchat.drafts": '{"abc":{"def":"unsent words"}}',
        "meshchatx_ui_theme": "dark",
    }
    response = await client.put(
        "/api/v1/app/ui-profile",
        json={"profile": profile},
        headers=headers,
    )
    assert response.status == 200

    response = await client.get("/api/v1/app/ui-profile")
    assert (await response.json())["profile"] == profile


@pytest.mark.asyncio
async def test_a_later_save_replaces_the_earlier_one(client):
    headers = await fetch_api_csrf_headers(client)
    await client.put(
        "/api/v1/app/ui-profile",
        json={"profile": {"meshchatx_ui_theme": "dark"}},
        headers=headers,
    )
    headers = await fetch_api_csrf_headers(client)
    await client.put(
        "/api/v1/app/ui-profile",
        json={"profile": {"meshchatx_ui_theme": "light"}},
        headers=headers,
    )
    response = await client.get("/api/v1/app/ui-profile")
    assert (await response.json())["profile"] == {"meshchatx_ui_theme": "light"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body", [{}, {"profile": None}, {"profile": []}, {"profile": "no"}]
)
async def test_anything_that_is_not_an_object_is_refused(client, body):
    headers = await fetch_api_csrf_headers(client)
    response = await client.put("/api/v1/app/ui-profile", json=body, headers=headers)
    assert response.status == 400


@pytest.mark.asyncio
async def test_a_profile_too_large_to_be_preferences_is_refused(client):
    # This is written from a browser into the identity's own database, so it
    # has a ceiling. Big enough for every preference and a conversation's worth
    # of drafts, small enough that nobody parks a file here.
    headers = await fetch_api_csrf_headers(client)
    response = await client.put(
        "/api/v1/app/ui-profile",
        json={"profile": {"meshchat.drafts": "x" * (256 * 1024 + 1)}},
        headers=headers,
    )
    assert response.status == 413


@pytest.mark.asyncio
async def test_a_document_that_cannot_be_parsed_reads_as_empty(client, mock_app):
    # Somebody signing in should get defaults rather than an error, and the
    # next save replaces the damaged document.
    mock_app.config.set("ui_profile", "{not json")
    response = await client.get("/api/v1/app/ui-profile")
    assert response.status == 200
    assert await response.json() == {"profile": {}}


@pytest.mark.asyncio
async def test_a_stored_document_that_is_not_an_object_reads_as_empty(client, mock_app):
    mock_app.config.set("ui_profile", json.dumps(["not", "an", "object"]))
    response = await client.get("/api/v1/app/ui-profile")
    assert await response.json() == {"profile": {}}
