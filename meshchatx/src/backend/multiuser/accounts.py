# SPDX-License-Identifier: 0BSD
"""The account store, which spans identities rather than living inside one.

An account is a person: a name they sign in with, a password, a role, and the
identity that is theirs. It cannot live in a per identity database, because
sign in has to find the account before it knows which identity to open.

The database is created on first use and only when the feature is switched on,
so a single user install never has one. Nothing here touches the per identity
databases or the Reticulum stack.
"""

import os
import re
import sqlite3
import time

import bcrypt

from meshchatx.src.backend.multiuser import ROLE_ADMIN, ROLE_USER, ROLES

DATABASE_FILENAME = "accounts.db"

# Names people type. Deliberately narrow, because the name is shown to other
# users and a lookalike name is a way to impersonate someone.
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$")
MIN_PASSWORD_LENGTH = 8


class AccountError(Exception):
    """Something the caller can report to the person signing up."""


def normalize_username(value) -> str:
    """Lowercase and validate a username, or raise AccountError."""
    if not isinstance(value, str):
        raise AccountError("Username must be text")
    name = value.strip().lower()
    if not USERNAME_RE.match(name):
        raise AccountError(
            "Username must be 3 to 32 characters, letters, digits, dot, "
            "dash or underscore, and must start and end with a letter or digit",
        )
    return name


class AccountStore:
    """Accounts, in their own database beside the identities directory."""

    def __init__(self, storage_dir: str):
        self.path = os.path.join(storage_dir, DATABASE_FILENAME)
        os.makedirs(storage_dir, exist_ok=True)
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._create_schema()

    def close(self):
        try:
            self._connection.close()
        except Exception:
            pass

    def _create_schema(self):
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                identity_hash TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL,
                last_login_at REAL
            )
            """,
        )
        self._connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username "
            "ON accounts(username)",
        )
        self._connection.commit()

    def count(self) -> int:
        row = self._connection.execute("SELECT COUNT(*) AS n FROM accounts").fetchone()
        return int(row["n"]) if row else 0

    def get_by_username(self, username: str):
        try:
            name = normalize_username(username)
        except AccountError:
            return None
        return self._connection.execute(
            "SELECT * FROM accounts WHERE username = ?",
            (name,),
        ).fetchone()

    def get_by_identity_hash(self, identity_hash: str):
        return self._connection.execute(
            "SELECT * FROM accounts WHERE identity_hash = ?",
            (str(identity_hash).lower(),),
        ).fetchone()

    def list_accounts(self):
        return self._connection.execute(
            "SELECT id, username, identity_hash, role, enabled, created_at, "
            "last_login_at FROM accounts ORDER BY username",
        ).fetchall()

    def create(
        self, username: str, password: str, identity_hash: str, role: str = ROLE_USER
    ):
        """Add an account. Raises AccountError on anything the caller can fix.

        The first account is an admin whatever role is asked for, because an
        install with no admin cannot be administered.
        """
        name = normalize_username(username)
        if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
            raise AccountError(
                "Password must be at least %d characters" % MIN_PASSWORD_LENGTH,
            )
        if role not in ROLES:
            raise AccountError("Unknown role")
        if self.count() == 0:
            role = ROLE_ADMIN

        password_hash = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt(),
        ).decode("utf-8")
        try:
            cursor = self._connection.execute(
                "INSERT INTO accounts (username, password_hash, identity_hash, "
                "role, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
                (name, password_hash, str(identity_hash).lower(), role, time.time()),
            )
            self._connection.commit()
        except sqlite3.IntegrityError as exc:
            # Say which constraint failed. A caller told "username taken" when
            # the real clash is the identity will retry forever with new names.
            if "identity_hash" in str(exc):
                raise AccountError(
                    "That identity already belongs to an account",
                ) from exc
            raise AccountError("That username is already taken") from exc
        return self._connection.execute(
            "SELECT * FROM accounts WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

    def verify(self, username: str, password: str):
        """Return the account when the password matches, otherwise None.

        A missing account still costs a hash comparison, so the response time
        does not reveal whether a username exists.
        """
        row = self.get_by_username(username)
        candidate = (password or "").encode("utf-8")
        stored = row["password_hash"].encode("utf-8") if row else _DUMMY_HASH
        try:
            matched = bcrypt.checkpw(candidate, stored)
        except (ValueError, TypeError):
            matched = False
        if not row or not matched or not row["enabled"]:
            return None
        return row

    def record_login(self, account_id: int):
        self._connection.execute(
            "UPDATE accounts SET last_login_at = ? WHERE id = ?",
            (time.time(), int(account_id)),
        )
        self._connection.commit()

    def set_role(self, account_id: int, role: str):
        if role not in ROLES:
            raise AccountError("Unknown role")
        self._connection.execute(
            "UPDATE accounts SET role = ? WHERE id = ?",
            (role, int(account_id)),
        )
        self._connection.commit()

    def set_enabled(self, account_id: int, enabled: bool):
        self._connection.execute(
            "UPDATE accounts SET enabled = ? WHERE id = ?",
            (1 if enabled else 0, int(account_id)),
        )
        self._connection.commit()

    def delete(self, account_id: int):
        """Remove the account. The identity and its data are left alone."""
        self._connection.execute(
            "DELETE FROM accounts WHERE id = ?",
            (int(account_id),),
        )
        self._connection.commit()

    def admin_count(self) -> int:
        row = self._connection.execute(
            "SELECT COUNT(*) AS n FROM accounts WHERE role = ? AND enabled = 1",
            (ROLE_ADMIN,),
        ).fetchone()
        return int(row["n"]) if row else 0


# Compared against when no account matches, so a wrong username and a wrong
# password take the same time.
_DUMMY_HASH = bcrypt.hashpw(b"meshchatx-timing-equaliser", bcrypt.gensalt())
