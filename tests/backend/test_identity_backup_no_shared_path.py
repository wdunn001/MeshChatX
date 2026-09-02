# SPDX-License-Identifier: 0BSD

"""Oracle: exporting an identity's private key must never touch a shared instance-wide path.

IdentityManager.backup_identity used to write the caller's private key bytes
to self.identity_file_path (or storage_dir/identity), then read that same
path back for the HTTP response. There is exactly one IdentityManager for
the whole app (meshchat.py constructs it once), so that path is shared by
every identity on the instance, not scoped to any one of them.

On a single user desktop install nothing else is ever writing there at the
same time, so the bug was invisible. On a shared multi-user instance, two
accounts calling /api/v1/identity/backup/download around the same moment
both write to that one file: whichever write lands last decides what BOTH
callers read back, so one account can receive the other's private key,
which on Reticulum is that person's entire identity, permanently, with no
recovery and no revocation. The file was also left on disk afterward.

The fix serves the bytes straight from memory (the same shape
backup_identity_base32 already used) and never touches disk at all. These
tests exercise the real IdentityManager and real RNS identities, not
mocks, since the whole question is what actually ends up on disk and in
the returned bytes.
"""

from __future__ import annotations

import os
import tempfile
import threading

import RNS

from meshchatx.src.backend.identity_manager import IdentityManager


def _all_files_under(root: str) -> set[str]:
    found = set()
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            found.add(os.path.join(dirpath, name))
    return found


def _load_identity(storage_dir: str, identity_hash: str) -> RNS.Identity:
    identity_file = os.path.join(storage_dir, "identities", identity_hash, "identity")
    identity = RNS.Identity.from_file(identity_file)
    assert identity is not None
    return identity


def test_backup_identity_writes_nothing_to_disk():
    """No file appears anywhere under storage_dir as a side effect of a call.

    Specifically not at storage_dir/identity, which is the exact shared
    path the bug used.
    """
    with tempfile.TemporaryDirectory() as tmp:
        manager = IdentityManager(tmp)
        created = manager.create_identity(display_name="alice")
        identity = _load_identity(tmp, created["hash"])

        before = _all_files_under(tmp)
        data = manager.backup_identity(identity)
        after = _all_files_under(tmp)

        assert after == before, f"backup_identity wrote new files: {after - before}"
        assert not os.path.isfile(os.path.join(tmp, "identity"))
        assert data == identity.get_private_key()


def test_backup_identity_with_explicit_identity_file_path_still_writes_nothing():
    """Constructed the way the running app constructs it.

    With the desktop build's identity_file_path argument set, since that
    is the exact shared target the bug wrote to when it was not the
    default fallback path either.
    """
    with tempfile.TemporaryDirectory() as tmp:
        shared_path = os.path.join(tmp, "main_identity_bootstrap_file")
        manager = IdentityManager(tmp, identity_file_path=shared_path)
        created = manager.create_identity(display_name="alice")
        identity = _load_identity(tmp, created["hash"])

        manager.backup_identity(identity)

        assert not os.path.exists(shared_path)


def test_concurrent_exports_never_cross_between_identities():
    """Two accounts exporting at the same instant must each get back only their own key.

    Run on real OS threads with a barrier so both calls are genuinely in
    flight at once, which is what a race needs to manifest, rather than
    two calls that merely happen one after another.
    """
    with tempfile.TemporaryDirectory() as tmp:
        manager = IdentityManager(tmp)
        created_a = manager.create_identity(display_name="alice")
        created_b = manager.create_identity(display_name="bob")

        identity_a = _load_identity(tmp, created_a["hash"])
        identity_b = _load_identity(tmp, created_b["hash"])

        key_a = identity_a.get_private_key()
        key_b = identity_b.get_private_key()
        # Sanity: two distinct real keys, or the rest of this test proves
        # nothing.
        assert key_a != key_b

        barrier = threading.Barrier(2)
        results: dict[str, bytes] = {}
        errors: list[BaseException] = []

        def export(name: str, identity: RNS.Identity) -> None:
            try:
                barrier.wait(timeout=5)
                results[name] = manager.backup_identity(identity)
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [
            threading.Thread(target=export, args=("alice", identity_a)),
            threading.Thread(target=export, args=("bob", identity_b)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert not errors, errors
        assert results["alice"] == key_a
        assert results["bob"] == key_b
        assert results["alice"] != results["bob"]

        # And neither export left anything behind for the other to find.
        assert not os.path.isfile(os.path.join(tmp, "identity"))


def test_many_concurrent_exports_across_many_identities_never_cross():
    """The two-identity case above, proven at higher concurrency.

    Every export among a larger set, fired at once, must resolve to
    exactly its own identity's key.
    """
    with tempfile.TemporaryDirectory() as tmp:
        manager = IdentityManager(tmp)
        identities = {}
        for name in ("alice", "bob", "carol", "dave", "erin", "frank"):
            created = manager.create_identity(display_name=name)
            identities[name] = _load_identity(tmp, created["hash"])

        expected = {name: ident.get_private_key() for name, ident in identities.items()}
        # Sanity: every key really is distinct.
        assert len(set(expected.values())) == len(expected)

        barrier = threading.Barrier(len(identities))
        results: dict[str, bytes] = {}
        errors: list[BaseException] = []

        def export(name: str, identity: RNS.Identity) -> None:
            try:
                barrier.wait(timeout=5)
                results[name] = manager.backup_identity(identity)
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [
            threading.Thread(target=export, args=(n, i)) for n, i in identities.items()
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert not errors, errors
        assert results == expected
