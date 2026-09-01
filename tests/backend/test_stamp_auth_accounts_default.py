# SPDX-License-Identifier: 0BSD

"""Oracle: accounts mode turns the sign up proof of work on by itself.

The gate used to depend on MESHCHAT_STAMP_AUTH_ENABLED alone, so a hosted
instance that lost that one variable in a redeploy accepted scripted sign ups
without anyone being told. configure_stamp_auth resolves the question from
what the instance actually is, and an operator who sets the variable still
wins in either direction.
"""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from meshchatx.src.backend.stamp_auth import (
    SETTINGS_HMAC_KEY,
    configure_stamp_auth,
    reset_stamp_auth_configuration,
    stamp_auth_enabled,
    stamp_auth_hmac_secret,
)

_ENV_ENABLED = "MESHCHAT_STAMP_AUTH_ENABLED"
_ENV_KEY = "MESHCHAT_STAMP_AUTH_HMAC_KEY"


@pytest.fixture(autouse=True)
def _clean_runtime():
    reset_stamp_auth_configuration()
    yield
    reset_stamp_auth_configuration()


@pytest.fixture
def storage(tmp_path):
    directory = tmp_path / "storage"
    directory.mkdir()
    return str(directory)


def _settings(storage_dir):
    path = os.path.join(storage_dir, "app_security.json")
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def test_accounts_mode_enables_the_stamp_without_any_variable(storage):
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop(_ENV_ENABLED, None)
        os.environ.pop(_ENV_KEY, None)
        assert configure_stamp_auth(storage, multiuser_enabled=True) is True
    assert stamp_auth_enabled() is True
    assert stamp_auth_hmac_secret()


def test_a_single_user_instance_still_has_no_stamp(storage):
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop(_ENV_ENABLED, None)
        os.environ.pop(_ENV_KEY, None)
        assert configure_stamp_auth(storage, multiuser_enabled=False) is False
    assert stamp_auth_enabled() is False


def test_an_operator_can_switch_it_off_in_accounts_mode(storage):
    with patch.dict(os.environ, {_ENV_ENABLED: "0"}, clear=False):
        os.environ.pop(_ENV_KEY, None)
        assert configure_stamp_auth(storage, multiuser_enabled=True) is False
    assert stamp_auth_enabled() is False


def test_an_operator_can_switch_it_on_for_a_single_user_instance(storage):
    with patch.dict(
        os.environ,
        {_ENV_ENABLED: "1", _ENV_KEY: "operator-supplied-key"},
        clear=False,
    ):
        assert configure_stamp_auth(storage, multiuser_enabled=False) is True
        assert stamp_auth_hmac_secret() == "operator-supplied-key"


def test_the_generated_key_is_persisted_and_reused_across_starts(storage):
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop(_ENV_ENABLED, None)
        os.environ.pop(_ENV_KEY, None)
        configure_stamp_auth(storage, multiuser_enabled=True)
        first = stamp_auth_hmac_secret()
        stored = _settings(storage).get(SETTINGS_HMAC_KEY)
        assert stored == first
        assert len(first) == 64

        reset_stamp_auth_configuration()
        configure_stamp_auth(storage, multiuser_enabled=True)
        assert stamp_auth_hmac_secret() == first


def test_the_generated_key_does_not_clobber_the_allowlist_settings(storage):
    path = os.path.join(storage, "app_security.json")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(
            json.dumps({"auth_mode": "accounts", "trusted_proxy_cidrs": "10.0.0.0/8"})
        )
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop(_ENV_ENABLED, None)
        os.environ.pop(_ENV_KEY, None)
        configure_stamp_auth(storage, multiuser_enabled=True)
    settings = _settings(storage)
    assert settings["auth_mode"] == "accounts"
    assert settings["trusted_proxy_cidrs"] == "10.0.0.0/8"
    assert settings[SETTINGS_HMAC_KEY] == stamp_auth_hmac_secret()


def test_the_environment_key_is_preferred_over_the_stored_one(storage):
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop(_ENV_ENABLED, None)
        os.environ.pop(_ENV_KEY, None)
        configure_stamp_auth(storage, multiuser_enabled=True)
        generated = stamp_auth_hmac_secret()

    reset_stamp_auth_configuration()
    with patch.dict(os.environ, {_ENV_KEY: "from-the-environment"}, clear=False):
        os.environ.pop(_ENV_ENABLED, None)
        configure_stamp_auth(storage, multiuser_enabled=True)
        assert stamp_auth_hmac_secret() == "from-the-environment"
    assert _settings(storage)[SETTINGS_HMAC_KEY] == generated
