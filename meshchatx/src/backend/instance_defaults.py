# SPDX-License-Identifier: 0BSD

"""Per identity settings an operator chooses once for the whole instance.

A hosted instance creates an identity for every person who signs up, and each
one starts from the shipped defaults in ConfigManager. Some of those defaults
are wrong for a shared terminal: name resolution is off out of the box, which
is right for a desktop install with no resolver to talk to and wrong for an
instance whose operator runs the resolvers.

Seeding happens once per identity, and only for keys that identity has never
written. Someone who turns a seeded setting off keeps it off, including across
restarts, because the key exists from then on.

Read from the environment first, then from app_security.json under the storage
directory, so a container can be configured without a browser and an operator
can change their mind without editing a compose file.
"""

from __future__ import annotations

import os

from meshchatx.src.backend.app_security_settings import load_app_security_settings
from meshchatx.src.env_utils import env_bool

ENV_RNS_RESOLVE_ENABLED = "MESHCHAT_RNS_RESOLVE_ENABLED"
ENV_RNS_RESOLVE_RESOLVERS = "MESHCHAT_RNS_RESOLVE_RESOLVERS"

SETTINGS_RNS_RESOLVE_ENABLED = "rns_resolve_enabled"
SETTINGS_RNS_RESOLVE_RESOLVERS = "rns_resolve_resolvers"

_HEX = "0123456789abcdef"


def normalize_resolver_hashes(raw) -> str | None:
    """The stored form: one destination hash per line, lowercase.

    Accepts a list, or text separated by newlines, commas, spaces or
    semicolons, because a compose file and a settings file do not agree on
    which of those is natural. Anything that is not a 32 character hex
    destination hash is dropped rather than stored, so a typo fails at
    configuration time instead of at resolve time.
    """
    if raw is None:
        return None
    if isinstance(raw, (list, tuple)):
        candidates = [str(item) for item in raw]
    else:
        text = str(raw)
        for separator in (",", ";", " ", "\t"):
            text = text.replace(separator, "\n")
        candidates = text.split("\n")

    seen = []
    for candidate in candidates:
        value = candidate.strip().lower()
        if len(value) != 32 or any(character not in _HEX for character in value):
            continue
        if value not in seen:
            seen.append(value)
    if not seen:
        return None
    return "\n".join(seen)


def _settings(storage_dir: str | None) -> dict:
    if not storage_dir:
        return {}
    try:
        return load_app_security_settings(storage_dir)
    except Exception:
        return {}


def rns_resolve_defaults(storage_dir: str | None) -> dict:
    """What a new identity should start with for name resolution.

    Returns an empty dictionary when the operator has configured nothing, which
    leaves ConfigManager's own defaults in place.
    """
    settings = _settings(storage_dir)

    resolvers = normalize_resolver_hashes(
        os.environ.get(ENV_RNS_RESOLVE_RESOLVERS),
    )
    if resolvers is None:
        resolvers = normalize_resolver_hashes(
            settings.get(SETTINGS_RNS_RESOLVE_RESOLVERS),
        )

    if os.environ.get(ENV_RNS_RESOLVE_ENABLED, "").strip():
        enabled = env_bool(ENV_RNS_RESOLVE_ENABLED, False)
    elif SETTINGS_RNS_RESOLVE_ENABLED in settings:
        enabled = bool(settings.get(SETTINGS_RNS_RESOLVE_ENABLED))
    else:
        # Naming is only useful with somewhere to ask, so an operator who
        # named their resolvers has already said what they want here.
        enabled = resolvers is not None

    defaults = {}
    if resolvers is not None:
        defaults["rns_resolve_resolver_destination_hashes"] = resolvers
    if resolvers is not None or os.environ.get(
        ENV_RNS_RESOLVE_ENABLED,
        "",
    ).strip() or SETTINGS_RNS_RESOLVE_ENABLED in settings:
        defaults["rns_resolve_enabled"] = "true" if enabled else "false"
    return defaults


def seed_identity_config(config, storage_dir: str | None) -> list[str]:
    """Write the instance defaults an identity has never written itself.

    Returns the keys that were seeded, which is what the caller logs. An
    identity that already holds a key keeps its own value, so this is safe to
    run on every start rather than only on the first one.
    """
    seeded = []
    for key, value in rns_resolve_defaults(storage_dir).items():
        try:
            if config.get(key, None) is not None:
                continue
            config.set(key, value)
            seeded.append(key)
        except Exception:
            continue
    return seeded
