# SPDX-License-Identifier: 0BSD
"""Bind each request to the identity of the person who made it.

The session already carries identity_hash, which single user sign in has always
set. This reads it and binds that person's context for the duration of the
request, so app.database and its neighbours resolve to them rather than to
whichever identity happens to be current.

Installed only when the feature is switched on, so a single user install does
not carry the cost of a lookup on every request.
"""

import os

from aiohttp import web
from aiohttp_session import get_session

from meshchatx.src.backend.request_context import (
    reset_active_context,
    set_active_context,
)
from meshchatx.src.path_utils import is_path_within_dir


def resolve_context(app, identity_hash):
    """The running context for an identity, started if it is not running yet.

    Unlike switching identity, this leaves current_context and every other
    running context alone, which is what lets several people be signed in at
    once. Returns None when the identity is unknown or cannot be loaded, and
    the caller then falls back to existing behaviour.
    """
    if not identity_hash or not isinstance(identity_hash, str):
        return None
    canonical = identity_hash.strip().lower()
    if len(canonical) != 32 or not all(c in "0123456789abcdef" for c in canonical):
        return None

    existing = app.contexts.get(canonical)
    if existing is not None:
        if not existing.running:
            try:
                existing.setup()
            except Exception:
                return None
        return existing

    identities_root = os.path.join(app.storage_dir, "identities")
    identity_dir = os.path.join(identities_root, canonical)
    # The hash comes from a session, so treat it as untrusted input and keep it
    # inside the identities directory.
    if not is_path_within_dir(identity_dir, identities_root):
        return None
    identity_file = os.path.join(identity_dir, "identity")
    if not os.path.isfile(identity_file):
        return None

    try:
        import RNS

        from meshchatx.src.backend.identity_context import IdentityContext

        identity = RNS.Identity.from_file(identity_file)
        if not identity or identity.hash.hex() != canonical:
            return None
        context = IdentityContext(identity, app)
        app.contexts[canonical] = context
        context.setup()
    except Exception:
        app.contexts.pop(canonical, None)
        return None
    return context


def create_multiuser_middleware(app):
    @web.middleware
    async def multiuser_middleware(request, handler):
        try:
            session = await get_session(request)
            identity_hash = session.get("identity_hash")
        except Exception:
            # A session that cannot be read is not a reason to refuse the
            # request. It simply is not bound to anyone.
            identity_hash = None

        context = resolve_context(app, identity_hash) if identity_hash else None
        if context is None:
            return await handler(request)

        token = set_active_context(context)
        try:
            return await handler(request)
        finally:
            # Always unbind, so a pooled task never inherits the last request's
            # identity.
            reset_active_context(token)

    return multiuser_middleware
