# SPDX-License-Identifier: 0BSD
"""Sign up, sign in, and who am I, for an instance serving several people.

Registered only when the feature is switched on, so these paths do not exist on
a single user install.

Registration creates a Reticulum identity and an account that owns it. The
identity is the point: it is what gives someone an LXMF address, so they can
reach the outside world through this instance rather than merely log into it.
"""

from aiohttp import web
from aiohttp_session import get_session

from meshchatx.src.backend.multiuser import (
    ROLE_USER,
    is_enabled,
    registration_open,
    set_registration_open,
)
from meshchatx.src.backend.multiuser.accounts import (
    AccountError,
    AccountStore,
    normalize_username,
)
from meshchatx.src.backend.stamp_auth import require_stamp_payload
from meshchatx.src.backend.csrf import rotate_session_csrf_token
from meshchatx.src.backend.multiuser import rate_limit
from meshchatx.src.backend.multiuser.middleware import resolve_context


def _account_public(row) -> dict:
    return {
        "username": row["username"],
        "role": row["role"],
        "identity_hash": row["identity_hash"],
    }


async def _sign_in(request, app, account):
    """Put the account into the session, replacing anything already there."""
    session = await get_session(request)
    session.invalidate()
    session = await get_session(request)
    session["authenticated"] = True
    session["identity_hash"] = account["identity_hash"]
    session["username"] = account["username"]
    rotate_session_csrf_token(session)


def register_multiuser_routes(routes, app):
    """Add the account routes. Called only when the feature is enabled."""
    if not is_enabled(app.storage_dir):
        return

    store = AccountStore(app.storage_dir)
    app.account_store = store

    @routes.get("/api/v1/multiuser/status")
    async def multiuser_status(request):
        session = await get_session(request)
        username = session.get("username")
        account = store.get_by_username(username) if username else None
        return web.json_response(
            {
                "enabled": True,
                "accounts": store.count(),
                "registration_open": registration_open(app.storage_dir),
                "signed_in": bool(account),
                "account": _account_public(account) if account else None,
            },
        )

    @routes.post("/api/v1/multiuser/register")
    async def multiuser_register(request):
        if not registration_open(app.storage_dir):
            return web.json_response(
                {"error": "Sign ups are closed on this instance"},
                status=403,
            )
        if not rate_limit.check(request, app.storage_dir, "register"):
            wait = rate_limit.retry_after(app.storage_dir, "register")
            return web.json_response(
                {"error": "Too many sign ups from here. Try again shortly."},
                status=429,
                headers={"Retry-After": str(wait)} if wait else None,
            )
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request"}, status=400)
        if not isinstance(data, dict):
            return web.json_response({"error": "Invalid request"}, status=400)

        # Registration is deliberately open to anyone who can reach this
        # instance, so this is the primary defence against a bot scripting
        # its way through sign up. A no-op when stamp auth is not configured.
        stamp_blocked = await require_stamp_payload(request, data)
        if stamp_blocked is not None:
            return stamp_blocked

        try:
            username = normalize_username(data.get("username"))
        except AccountError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        password = data.get("password")
        if not isinstance(password, str):
            return web.json_response(
                {"error": "Password must be text"},
                status=400,
            )

        if store.get_by_username(username) is not None:
            return web.json_response(
                {"error": "That username is already taken"},
                status=409,
            )

        # Make the identity first. Without one there is nothing for the account
        # to own, and no address to reach the outside world from.
        try:
            created = app.identity_manager.create_identity(display_name=username)
            identity_hash = created.get("hash")
        except Exception:
            return web.json_response(
                {"error": "Could not create an identity"},
                status=500,
            )
        if not identity_hash:
            return web.json_response(
                {"error": "Could not create an identity"},
                status=500,
            )

        try:
            account = store.create(username, password, identity_hash, role=ROLE_USER)
        except AccountError as exc:
            # The identity is left on disk rather than deleted, because
            # removing keys on a failed sign up is a worse failure than an
            # unused directory. An admin can clear it.
            return web.json_response({"error": str(exc)}, status=400)

        await _sign_in(request, app, account)
        resolve_context(app, identity_hash)
        return web.json_response(
            {"message": "Welcome", "account": _account_public(account)},
        )

    @routes.post("/api/v1/multiuser/login")
    async def multiuser_login(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request"}, status=400)
        if not isinstance(data, dict):
            return web.json_response({"error": "Invalid request"}, status=400)

        # Same proof of work gate as sign up, so a bot cannot use this path
        # to brute-force a password once it has a username. A no-op when
        # stamp auth is not configured.
        stamp_blocked = await require_stamp_payload(request, data)
        if stamp_blocked is not None:
            return stamp_blocked

        if not rate_limit.check(request, app.storage_dir, "login"):
            wait = rate_limit.retry_after(app.storage_dir, "login")
            return web.json_response(
                {"error": "Too many sign in attempts from here."},
                status=429,
                headers={"Retry-After": str(wait)} if wait else None,
            )

        username = data.get("username")
        password = data.get("password")
        if not isinstance(username, str) or not isinstance(password, str):
            # Same answer as a wrong password, so a malformed body
            # cannot be used to tell valid usernames apart.
            return web.json_response(
                {"error": "Username or password is not right"},
                status=401,
            )
        account = store.verify(username, password)
        if account is None:
            # One message for both wrong name and wrong password, so the reply
            # does not say which usernames exist.
            return web.json_response(
                {"error": "Username or password is not right"},
                status=401,
            )

        await _sign_in(request, app, account)
        store.record_login(account["id"])
        if resolve_context(app, account["identity_hash"]) is None:
            return web.json_response(
                {"error": "Signed in, but that identity could not be started"},
                status=500,
            )
        return web.json_response(
            {"message": "Signed in", "account": _account_public(account)},
        )

    @routes.get("/api/v1/multiuser/accounts")
    async def multiuser_accounts(request):
        rows = store.list_accounts()
        return web.json_response(
            {
                "accounts": [
                    {
                        "id": r["id"],
                        "username": r["username"],
                        "role": r["role"],
                        "enabled": bool(r["enabled"]),
                        "identity_hash": r["identity_hash"],
                        "last_login_at": r["last_login_at"],
                    }
                    for r in rows
                ],
            },
        )

    @routes.patch("/api/v1/multiuser/accounts/{account_id}")
    async def multiuser_account_update(request):
        try:
            account_id = int(request.match_info["account_id"])
        except (KeyError, TypeError, ValueError):
            return web.json_response({"error": "Unknown account"}, status=404)
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request"}, status=400)

        target = None
        for row in store.list_accounts():
            if row["id"] == account_id:
                target = row
                break
        if target is None:
            return web.json_response({"error": "Unknown account"}, status=404)

        # An instance with no admin cannot be administered, so the last one
        # cannot demote or disable themselves out of existence.
        losing_admin = target["role"] == "admin" and (
            ("role" in data and data["role"] != "admin")
            or ("enabled" in data and not data["enabled"])
        )
        if losing_admin and store.admin_count() <= 1:
            return web.json_response(
                {"error": "This is the only admin, so it cannot be changed"},
                status=409,
            )

        try:
            if "role" in data:
                store.set_role(account_id, data["role"])
            if "enabled" in data:
                store.set_enabled(account_id, bool(data["enabled"]))
        except AccountError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        return web.json_response({"message": "Updated"})

    @routes.delete("/api/v1/multiuser/accounts/{account_id}")
    async def multiuser_account_delete(request):
        try:
            account_id = int(request.match_info["account_id"])
        except (KeyError, TypeError, ValueError):
            return web.json_response({"error": "Unknown account"}, status=404)

        target = None
        for row in store.list_accounts():
            if row["id"] == account_id:
                target = row
                break
        if target is None:
            return web.json_response({"error": "Unknown account"}, status=404)

        # Same reason the update route refuses: an instance with no admin
        # cannot be administered afterwards.
        if target["role"] == "admin" and store.admin_count() <= 1:
            return web.json_response(
                {"error": "This is the only admin, so it cannot be removed"},
                status=409,
            )

        session = await get_session(request)
        if session.get("username") == target["username"]:
            return web.json_response(
                {"error": "Sign out rather than removing the account you are using"},
                status=409,
            )

        store.delete(account_id)
        # The identity and its messages stay on disk. Removing someone's keys
        # because their account was closed destroys conversations other people
        # are still part of, and it cannot be undone.
        return web.json_response(
            {
                "message": "Removed",
                "identity_hash": target["identity_hash"],
                "identity_retained": True,
            },
        )

    @routes.get("/api/v1/multiuser/registration")
    async def multiuser_registration_get(request):
        return web.json_response(
            {"registration_open": registration_open(app.storage_dir)},
        )

    @routes.patch("/api/v1/multiuser/registration")
    async def multiuser_registration_set(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request"}, status=400)
        if not isinstance(data, dict) or "registration_open" not in data:
            return web.json_response({"error": "Invalid request"}, status=400)
        wanted = bool(data.get("registration_open"))
        try:
            set_registration_open(app.storage_dir, wanted)
        except OSError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response({"registration_open": wanted})

    @routes.post("/api/v1/multiuser/logout")
    async def multiuser_logout(request):
        session = await get_session(request)
        session.invalidate()
        return web.json_response({"message": "Signed out"})

    @routes.get("/api/v1/multiuser/me")
    async def multiuser_me(request):
        session = await get_session(request)
        username = session.get("username")
        account = store.get_by_username(username) if username else None
        if account is None:
            return web.json_response({"error": "Not signed in"}, status=401)
        return web.json_response({"account": _account_public(account)})
