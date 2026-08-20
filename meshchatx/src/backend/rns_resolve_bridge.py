# SPDX-License-Identifier: 0BSD
"""Bridge between MeshChatX and rns-resolve (human-readable NomadNet names).

This wraps the rns_resolve client pipeline so the web backend and the
NomadNet browse path can turn a typed name into a destination hash while
keeping every rns-resolve trust invariant intact:

  1. Classify. A 32 hex character string IS a destination hash. It is used
     directly and is NEVER sent to a resolver.
  2. Petnames. A locally pinned name answers with zero network traffic.
  3. Resolver. Only a petname miss, only when the feature is enabled and a
     resolver destination is configured, opens an RNS Link and sends the
     resolve op.
  4. TOFU. The one-shot browse path auto-pins a single registered record.
     The candidate list path returns ranked candidates for the UI to
     present and pins the user's explicit pick.

rns_resolve is imported lazily and defensively. When it is not installed,
is_available() returns False and every function degrades to "no result",
so MeshChatX behaves exactly as stock.
"""

import os

try:
    from rns_resolve import client as _rr_client
    from rns_resolve.petnames import PetnameTable as _PetnameTable
    from rns_resolve.records import HASH_RE as _HASH_RE
    from rns_resolve.records import normalize_name as _normalize_name

    RNS_RESOLVE_AVAILABLE = True
except Exception:
    RNS_RESOLVE_AVAILABLE = False


def is_available():
    return RNS_RESOLVE_AVAILABLE


def _petname_path(storage_dir):
    """Keep the petname store with the MeshChatX instance, not in ~."""
    base = os.path.join(storage_dir or "storage", "rns_resolve")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "petnames.json")


def _table(storage_dir):
    return _PetnameTable(_petname_path(storage_dir))


def is_hash(value):
    """True when the input already is a destination hash (32 hex chars)."""
    if not RNS_RESOLVE_AVAILABLE or not isinstance(value, str):
        return False
    return bool(_HASH_RE.match(value.strip()))


def browse_resolve(query, enabled, resolver_hash, rns_config, storage_dir):
    """One-shot name to hash for the NomadNet browse path.

    Returns a 32 hex hash string, or None to let the caller fall back to its
    stock "malformed address" behavior. A hash-shaped input is returned as
    is and never sent to a resolver. Never raises.
    """
    if not RNS_RESOLVE_AVAILABLE or not isinstance(query, str):
        return None
    q = query.strip()
    if _HASH_RE.match(q):
        return q.lower()
    try:
        name_norm = _normalize_name(q)
    except Exception:
        return None
    pets = _table(storage_dir)
    pinned = pets.get(name_norm)
    if pinned and pinned.get("hash"):
        return pinned["hash"]
    if not enabled or not resolver_hash:
        return None
    try:
        return _rr_client.resolve_name(
            name_norm,
            resolver_hash,
            rns_config=rns_config,
            petnames_table=pets,
        )
    except Exception:
        return None


def resolve_candidates(query, enabled, resolver_hash, rns_config, storage_dir):
    """Full resolve for the UI. Returns a dict the frontend can act on:

      {"kind": "hash",    "hash": "<hex>"}                already a hash
      {"kind": "petname", "hash": "<hex>", "name": "..."} locally pinned
      {"kind": "candidates", "name": "...",
       "registered": [...], "announced": [...]}           ranked, unpinned
      {"kind": "miss",    "name": "..."}                  nothing found
      {"kind": "disabled"}                                feature off / no resolver
      {"kind": "unavailable"}                             rns_resolve not installed
      {"kind": "error",   "message": "..."}               resolver call failed

    Never raises.
    """
    if not RNS_RESOLVE_AVAILABLE:
        return {"kind": "unavailable"}
    if not isinstance(query, str) or not query.strip():
        return {"kind": "miss", "name": ""}
    q = query.strip()
    if _HASH_RE.match(q):
        return {"kind": "hash", "hash": q.lower()}
    try:
        name_norm = _normalize_name(q)
    except Exception:
        return {"kind": "miss", "name": q}
    pets = _table(storage_dir)
    pinned = pets.get(name_norm)
    if pinned and pinned.get("hash"):
        return {"kind": "petname", "hash": pinned["hash"], "name": name_norm}
    if not enabled or not resolver_hash:
        return {"kind": "disabled", "name": name_norm}
    try:
        reply = _rr_client.resolve_remote(
            resolver_hash, name_norm, rns_config=rns_config,
        )
    except Exception as e:
        return {"kind": "error", "name": name_norm, "message": str(e)}
    if not isinstance(reply, dict) or not reply.get("ok"):
        return {"kind": "error", "name": name_norm,
                "message": (reply or {}).get("error", "resolver returned no answer")
                if isinstance(reply, dict) else "resolver returned no answer"}
    registered = reply.get("registered") or []
    announced = reply.get("announced") or []
    if not registered and not announced:
        return {"kind": "miss", "name": name_norm}
    return {
        "kind": "candidates",
        "name": name_norm,
        "registered": registered,
        "announced": announced,
    }


def pin(name, hash_hex, storage_dir, source="manual"):
    """Pin a name to a hash (TOFU). Returns True on success. Never raises."""
    if not RNS_RESOLVE_AVAILABLE:
        return False
    try:
        name_norm = _normalize_name(name)
        if not _HASH_RE.match(str(hash_hex).strip()):
            return False
        _table(storage_dir).pin(name_norm, str(hash_hex).strip().lower(), source)
        return True
    except Exception:
        return False


def list_pins(storage_dir):
    """Return the pinned petname table as a plain dict. Never raises."""
    if not RNS_RESOLVE_AVAILABLE:
        return {}
    try:
        return _table(storage_dir).all()
    except Exception:
        return {}
