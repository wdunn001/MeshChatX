# SPDX-License-Identifier: 0BSD
"""Which identity context the code currently running belongs to.

MeshChatX has always had one active identity at a time, so app.database and its
neighbours read app.current_context. That is correct for a single operator and
wrong the moment two people are signed in at once, because a request for Alice
would read whichever identity happened to be current.

This holds the context for the work in hand. An HTTP request sets it from the
session, so the properties resolve to the signed-in user rather than to a
global. Anything running outside a request leaves it unset and the properties
fall back to current_context, which is the existing single-user behaviour.

A ContextVar is used rather than a thread local because the web server is
asyncio: the value follows an await chain, and concurrent requests each get
their own. It does NOT propagate into threads started by RNS or LXMF, which is
correct here. Background work already holds the database it was constructed
with rather than reaching for app.database.
"""

import contextlib
import contextvars

_active_context = contextvars.ContextVar(
    "meshchatx_active_identity_context",
    default=None,
)


def get_active_context():
    """The context for the work in hand, or None outside a request."""
    return _active_context.get()


def set_active_context(context):
    """Bind a context to the work in hand. Returns a token to reset with."""
    return _active_context.set(context)


def reset_active_context(token):
    """Undo a set_active_context, so a task does not leak into the next one."""
    with contextlib.suppress(ValueError, LookupError):
        _active_context.reset(token)


@contextlib.contextmanager
def active_context(context):
    """Run a block as a given identity.

    Used where work has to be attributed to a user outside a request, such as
    a websocket message or a scheduled job acting on their behalf.
    """
    token = set_active_context(context)
    try:
        yield context
    finally:
        reset_active_context(token)
