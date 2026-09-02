# SPDX-License-Identifier: 0BSD
"""Multiple people signed in at once, each as their own identity.

Off unless switched on. While off, nothing here is constructed: no database is
opened or created, no middleware is added to the chain, and no background work
runs. The only cost is the flag check below, which reads a settings file the
server already reads for other reasons.

Switch it on with MESHCHAT_MULTIUSER=1, or by setting multiuser_enabled in
app_security.json under the storage directory.

Import the rest of this package lazily, behind is_enabled, so a single user
install never loads it.
"""

import json
import os

from meshchatx.src.backend.app_security_settings import load_app_security_settings
from meshchatx.src.env_utils import env_bool

SETTINGS_KEY = "multiuser_enabled"
REGISTRATION_KEY = "multiuser_registration_open"
ENV_VAR = "MESHCHAT_MULTIUSER"

# Roles, least to most. A role grants everything the roles before it grant.
ROLE_USER = "user"
ROLE_CONTRIBUTOR = "contributor"
ROLE_ADMIN = "admin"
ROLES = (ROLE_USER, ROLE_CONTRIBUTOR, ROLE_ADMIN)
_ROLE_RANK = {name: rank for rank, name in enumerate(ROLES)}


def is_enabled(storage_dir: str | None) -> bool:
    """True when this install serves more than one person.

    Deliberately cheap and side effect free, because it is checked on paths
    that run whether or not the feature is used. It creates nothing.
    """
    if env_bool(ENV_VAR, False):
        return True
    if not storage_dir or not os.path.isdir(storage_dir):
        return False
    try:
        settings = load_app_security_settings(storage_dir)
    except Exception:
        return False
    if settings.get(MODE_KEY) == MODE_ACCOUNTS:
        return True
    # The older explicit flag still works, so an instance configured before
    # modes existed keeps running.
    return bool(settings.get(SETTINGS_KEY, False))


def registration_open(storage_dir: str | None) -> bool:
    """True when strangers may sign themselves up.

    Open by default once the feature is on, because the point of it is an
    access point people can join. An operator closes it by setting
    multiuser_registration_open to false in app_security.json.
    """
    if not storage_dir or not os.path.isdir(storage_dir):
        return True
    try:
        settings = load_app_security_settings(storage_dir)
        return bool(settings.get(REGISTRATION_KEY, True))
    except Exception:
        return True


def set_registration_open(storage_dir: str, wanted: bool) -> None:
    """Open or close sign ups, without disturbing the rest of the settings.

    Written the same way save_auth_mode below writes, because
    save_app_security_settings only persists the two allowlist keys it knows
    about and silently drops everything else.
    """
    from meshchatx.src.backend.app_security_settings import update_app_security_raw

    update_app_security_raw(storage_dir, {REGISTRATION_KEY: bool(wanted)})


# How an instance decides who may use it. Chosen once, at first run.
MODE_OPEN = "open"  # no sign in, the historical default
MODE_SINGLE = "single"  # one shared password, the existing app auth
MODE_ACCOUNTS = "accounts"  # an account each, for a shared instance
MODES = (MODE_OPEN, MODE_SINGLE, MODE_ACCOUNTS)
MODE_KEY = "auth_mode"


def available_modes(served: bool) -> tuple[str, ...]:
    """The modes worth offering on this build.

    Accounts only make sense where an instance is served to other people, so
    they are offered on a server or container build and not on a packaged
    desktop app, where one person sits at one machine.

    Note that headless alone is the wrong test: a frozen Electron build also
    runs headless, meaning it opens no browser of its own, while still being a
    single person's desktop app. The caller passes headless AND not frozen.
    """
    if served:
        return MODES
    return (MODE_OPEN, MODE_SINGLE)


def save_auth_mode(storage_dir: str, mode: str) -> None:
    """Record how this instance is used.

    Written here rather than through save_app_security_settings, because that
    function only persists the two keys it knows about and drops anything else
    without saying so. Passing an unknown key there looks like it worked and
    changes nothing.
    """
    if mode not in MODES:
        raise ValueError("Unknown mode")
    path = os.path.join(storage_dir, "app_security.json")
    try:
        with open(path, encoding="utf-8") as handle:
            current = json.load(handle)
        if not isinstance(current, dict):
            current = {}
    except (OSError, json.JSONDecodeError):
        current = {}
    current[MODE_KEY] = mode
    os.makedirs(storage_dir, exist_ok=True)
    # Written through a temporary file and replaced, so a crash midway
    # cannot leave a half written settings file that stops the app
    # starting. Done here rather than with a shared helper, so this
    # module imports cleanly on older builds too.
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(current, indent=2) + chr(10))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def auth_mode(storage_dir: str | None) -> str | None:
    """The mode this instance is set to, or None when first run has not run.

    The environment switch forces accounts, so a container can be brought up
    already configured without anyone touching a browser.
    """
    if env_bool(ENV_VAR, False):
        return MODE_ACCOUNTS
    if not storage_dir or not os.path.isdir(storage_dir):
        return None
    try:
        stored = load_app_security_settings(storage_dir).get(MODE_KEY)
    except Exception:
        return None
    return stored if stored in MODES else None


def role_allows(role: str | None, required: str) -> bool:
    """True when role is at least required. Unknown roles grant nothing."""
    if role not in _ROLE_RANK or required not in _ROLE_RANK:
        return False
    return _ROLE_RANK[role] >= _ROLE_RANK[required]
