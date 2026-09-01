# SPDX-License-Identifier: 0BSD

"""Oracle: an operator's instance defaults reach every identity once.

Name resolution ships off, which is right for a desktop install with nothing
to ask and wrong for a hosted instance whose operator runs the resolvers. The
seeding is one-way: it fills keys an identity has never written, and never
overwrites a choice that identity already made.
"""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from meshchatx.src.backend.instance_defaults import (
    ENV_RNS_RESOLVE_ENABLED,
    ENV_RNS_RESOLVE_RESOLVERS,
    SETTINGS_RNS_RESOLVE_ENABLED,
    SETTINGS_RNS_RESOLVE_RESOLVERS,
    normalize_resolver_hashes,
    rns_resolve_defaults,
    seed_identity_config,
)

_ONE = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
_TWO = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"


class FakeConfig:
    """The two methods seed_identity_config uses, over a plain dictionary."""

    def __init__(self, existing=None):
        self.values = dict(existing or {})

    def get(self, key, default_value=None):
        return self.values.get(key, default_value)

    def set(self, key, value):
        self.values[key] = value


@pytest.fixture
def storage(tmp_path):
    directory = tmp_path / "storage"
    directory.mkdir()
    return str(directory)


def _write_settings(storage_dir, payload):
    path = os.path.join(storage_dir, "app_security.json")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(payload))


@pytest.fixture(autouse=True)
def _clean_env():
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop(ENV_RNS_RESOLVE_ENABLED, None)
        os.environ.pop(ENV_RNS_RESOLVE_RESOLVERS, None)
        yield


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, None),
        ("", None),
        ("   ", None),
        (_ONE, _ONE),
        (_ONE.upper(), _ONE),
        (f"{_ONE},{_TWO}", f"{_ONE}\n{_TWO}"),
        (f"{_ONE} {_TWO}", f"{_ONE}\n{_TWO}"),
        (f"{_ONE};{_TWO}", f"{_ONE}\n{_TWO}"),
        (f"{_ONE}\n{_ONE}", _ONE),
        ([_ONE, _TWO], f"{_ONE}\n{_TWO}"),
        ("not-a-hash", None),
        (_ONE[:31], None),
        (_ONE[:31] + "z", None),
        (f"{_ONE},nonsense", _ONE),
    ],
)
def test_resolver_hashes_are_accepted_or_rejected_on_their_shape(raw, expected):
    assert normalize_resolver_hashes(raw) == expected


def test_nothing_configured_leaves_the_shipped_defaults_alone(storage):
    assert rns_resolve_defaults(storage) == {}
    config = FakeConfig()
    assert seed_identity_config(config, storage) == []
    assert config.values == {}


def test_resolvers_in_the_environment_turn_naming_on(storage):
    os.environ[ENV_RNS_RESOLVE_RESOLVERS] = f"{_ONE},{_TWO}"
    config = FakeConfig()
    seeded = seed_identity_config(config, storage)
    assert sorted(seeded) == [
        "rns_resolve_enabled",
        "rns_resolve_resolver_destination_hashes",
    ]
    assert config.values["rns_resolve_enabled"] == "true"
    assert config.values["rns_resolve_resolver_destination_hashes"] == f"{_ONE}\n{_TWO}"


def test_resolvers_in_the_settings_file_turn_naming_on(storage):
    _write_settings(storage, {SETTINGS_RNS_RESOLVE_RESOLVERS: _ONE})
    config = FakeConfig()
    seed_identity_config(config, storage)
    assert config.values["rns_resolve_enabled"] == "true"
    assert config.values["rns_resolve_resolver_destination_hashes"] == _ONE


def test_the_environment_beats_the_settings_file(storage):
    _write_settings(storage, {SETTINGS_RNS_RESOLVE_RESOLVERS: _ONE})
    os.environ[ENV_RNS_RESOLVE_RESOLVERS] = _TWO
    config = FakeConfig()
    seed_identity_config(config, storage)
    assert config.values["rns_resolve_resolver_destination_hashes"] == _TWO


def test_an_operator_can_seed_resolvers_but_leave_naming_off(storage):
    _write_settings(
        storage,
        {
            SETTINGS_RNS_RESOLVE_RESOLVERS: _ONE,
            SETTINGS_RNS_RESOLVE_ENABLED: False,
        },
    )
    config = FakeConfig()
    seed_identity_config(config, storage)
    assert config.values["rns_resolve_enabled"] == "false"
    assert config.values["rns_resolve_resolver_destination_hashes"] == _ONE


def test_a_choice_the_identity_already_made_is_never_overwritten(storage):
    os.environ[ENV_RNS_RESOLVE_RESOLVERS] = _ONE
    config = FakeConfig({"rns_resolve_enabled": "false"})
    seeded = seed_identity_config(config, storage)
    assert seeded == ["rns_resolve_resolver_destination_hashes"]
    assert config.values["rns_resolve_enabled"] == "false"


def test_seeding_twice_changes_nothing_the_second_time(storage):
    os.environ[ENV_RNS_RESOLVE_RESOLVERS] = _ONE
    config = FakeConfig()
    assert seed_identity_config(config, storage)
    config.values["rns_resolve_enabled"] = "false"
    assert seed_identity_config(config, storage) == []
    assert config.values["rns_resolve_enabled"] == "false"
