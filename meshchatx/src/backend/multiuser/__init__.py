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

import os

from meshchatx.src.backend.app_security_settings import load_app_security_settings
from meshchatx.src.env_utils import env_bool

SETTINGS_KEY = "multiuser_enabled"
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
        return bool(load_app_security_settings(storage_dir).get(SETTINGS_KEY, False))
    except Exception:
        return False


def role_allows(role: str | None, required: str) -> bool:
    """True when role is at least required. Unknown roles grant nothing."""
    if role not in _ROLE_RANK or required not in _ROLE_RANK:
        return False
    return _ROLE_RANK[role] >= _ROLE_RANK[required]
