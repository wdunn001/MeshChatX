# SPDX-License-Identifier: 0BSD
"""Client for rns-resolve, which gives NomadNet addresses human-readable names.

MeshChatX is a CLIENT here. A resolver is a separate service somewhere on the
mesh; this module only knows how to ask one a question and what to do with the
answer. There is no new dependency: the request rides an RNS Link and is packed
with the msgpack copy that ships inside RNS, both of which MeshChatX already
uses elsewhere.

The resolve path, in order, so the cheap and private steps come first:

  1. Classify. A 32 hex character string already IS a destination hash. It is
     used directly and is NEVER sent to a resolver, so browsing by hash tells
     no one what you are reading.
  2. Local pin. A name the user has already pinned answers with zero network
     traffic.
  3. Resolver. Only a pin miss, only when the feature is switched on and a
     resolver destination is configured, opens a Link.
  4. Trust on first use. A pinned name is never silently repointed. If a
     resolver later answers with a different hash for a pinned name, the pin
     stands and the caller is told, rather than the address quietly changing
     under the user.

Pins live in the custom_destination_display_names table MeshChatX already
keeps, extended in schema v56 with name_norm, name_source, first_seen and
last_verified. There is deliberately no second naming store.

Protocol (rns-resolve CONTRACTS.md): app "rnsresolve", aspect "query", request
path "q", msgpack payload {"v": 1, "op": "resolve", "q": <normalized name>}.
"""

import re
import threading
import time
import unicodedata

# Wire protocol. These identify the resolver service on the mesh.
APP_NAME = "rnsresolve"
ASPECT = "query"
REQUEST_PATH = "q"
DEFAULT_TIMEOUT = 15.0

# A destination hash is 16 bytes, written as 32 hex characters.
HASH_RE = re.compile(r"^[0-9a-fA-F]{32}$")

# Name rules, mirroring rns-resolve CONTRACTS.md. Kept here deliberately so an
# obviously invalid name is rejected without costing a mesh round trip. The
# resolver remains the authority and validates again.
MAX_LABELS = 3
MAX_LABEL_LEN = 32
MAX_NAME_LEN = 64
_LABEL_RE = re.compile(r"^[a-z0-9_-]+$")


def is_available():
    """True when the resolver client can run at all.

    Only RNS is required, and MeshChatX already depends on it, so this is
    effectively always true. It stays here so callers have one place to ask,
    and so a stripped build without RNS degrades instead of raising.
    """
    try:
        import RNS  # noqa: F401

        return True
    except Exception:
        return False


def _msgpack():
    """Prefer a standalone umsgpack, fall back to the copy vendored in RNS."""
    try:
        import umsgpack

        return umsgpack
    except ImportError:
        from RNS.vendor import umsgpack

        return umsgpack


def is_hash(value):
    """True when the input already is a destination hash."""
    return isinstance(value, str) and bool(HASH_RE.match(value.strip()))


def normalize_name(s):
    """Normalize a human-readable name, or raise ValueError.

    Lowercase, NFC normalized, labels split on ".", at most 3 labels, each
    label 1 to 32 characters from [a-z0-9_-] and not starting or ending with
    "-", 64 characters overall.
    """
    if not isinstance(s, str):
        raise ValueError("name must be a string")
    name = unicodedata.normalize("NFC", s).strip().lower()
    if not name:
        raise ValueError("name is empty")
    if len(name) > MAX_NAME_LEN:
        raise ValueError("name longer than %d chars" % MAX_NAME_LEN)
    labels = name.split(".")
    if len(labels) > MAX_LABELS:
        raise ValueError("name has more than %d labels" % MAX_LABELS)
    for label in labels:
        if not label:
            raise ValueError("empty label in name")
        if len(label) > MAX_LABEL_LEN:
            raise ValueError("label longer than %d chars" % MAX_LABEL_LEN)
        if not _LABEL_RE.match(label):
            raise ValueError("label contains characters outside [a-z0-9_-]")
        if label[0] == "-" or label[-1] == "-":
            raise ValueError("label must not start or end with '-'")
    return name


def _wait(predicate, timeout, interval=0.1):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def resolve_remote(resolver_hash, name_norm, timeout=DEFAULT_TIMEOUT):
    """Ask a resolver for a name. Returns the reply dict. Raises on failure.

    Opens a Link to the resolver, sends one request, and tears the Link down
    again. RNS is assumed to be initialised already, since MeshChatX runs its
    own instance.
    """
    import RNS

    umsgpack = _msgpack()
    dest_bytes = bytes.fromhex(resolver_hash)

    if not RNS.Transport.has_path(dest_bytes):
        RNS.Transport.request_path(dest_bytes)
        if not _wait(lambda: RNS.Transport.has_path(dest_bytes), timeout):
            raise TimeoutError("no path to resolver " + resolver_hash)

    server_identity = RNS.Identity.recall(dest_bytes)
    if server_identity is None:
        raise RuntimeError("could not recall resolver identity")

    destination = RNS.Destination(
        server_identity,
        RNS.Destination.OUT,
        RNS.Destination.SINGLE,
        APP_NAME,
        ASPECT,
    )
    link = RNS.Link(destination)
    try:
        if not _wait(lambda: link.status == RNS.Link.ACTIVE, timeout):
            raise TimeoutError("link to resolver did not establish")

        done = threading.Event()
        box = {}

        def _on_response(receipt):
            box["data"] = receipt.response
            done.set()

        def _on_failed(_receipt):
            box["err"] = "request failed"
            done.set()

        link.request(
            REQUEST_PATH,
            umsgpack.packb({"v": 1, "op": "resolve", "q": name_norm}),
            response_callback=_on_response,
            failed_callback=_on_failed,
            timeout=timeout,
        )
        if not done.wait(timeout + 5):
            raise TimeoutError("no response from resolver")
        if "err" in box:
            raise RuntimeError(box["err"])
        data = box.get("data")
        if isinstance(data, (bytes, bytearray)):
            return umsgpack.unpackb(bytes(data))
        return data
    finally:
        try:
            link.teardown()
        except Exception:
            pass


def resolve_candidates(query, enabled, resolver_hash, announces):
    """Resolve a typed address for the UI. Never raises.

    Returns one of:
      {"kind": "hash",       "hash": ...}                 already a hash
      {"kind": "pinned",     "hash": ..., "name": ...}    locally pinned
      {"kind": "candidates", "name": ..., "registered": [], "announced": []}
      {"kind": "miss",       "name": ...}
      {"kind": "disabled",   "name": ...}                 off or unconfigured
      {"kind": "error",      "name": ..., "message": ...}
    """
    if not isinstance(query, str) or not query.strip():
        return {"kind": "miss", "name": ""}
    q = query.strip()
    if HASH_RE.match(q):
        return {"kind": "hash", "hash": q.lower()}
    try:
        name_norm = normalize_name(q)
    except ValueError:
        return {"kind": "miss", "name": q}

    try:
        pinned = announces.get_hash_for_name(name_norm)
    except Exception:
        pinned = None
    if pinned:
        return {"kind": "pinned", "hash": pinned, "name": name_norm}

    if not enabled or not resolver_hash:
        return {"kind": "disabled", "name": name_norm}

    try:
        reply = resolve_remote(resolver_hash, name_norm)
    except Exception as e:
        return {"kind": "error", "name": name_norm, "message": str(e)}

    if not isinstance(reply, dict) or not reply.get("ok"):
        message = "resolver returned no answer"
        if isinstance(reply, dict) and reply.get("error"):
            message = str(reply["error"])
        return {"kind": "error", "name": name_norm, "message": message}

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


def browse_resolve(query, enabled, resolver_hash, announces):
    """One shot name to hash for the browse path, or None to fall back.

    Only a registered record is accepted. An announced name is an unverified
    self claim, and this path has no UI in which to present that choice.
    """
    result = resolve_candidates(query, enabled, resolver_hash, announces)
    kind = result.get("kind")
    if kind in ("hash", "pinned"):
        return result.get("hash")
    if kind != "candidates":
        return None
    registered = result.get("registered") or []
    if len(registered) != 1:
        return None
    target = str(registered[0].get("target") or "")
    if not HASH_RE.match(target):
        return None
    pin(result.get("name"), target, announces, source="resolver")
    return target.lower()


def pin(name, hash_hex, announces, source="manual"):
    """Pin a name to a hash. False if that name is already pinned elsewhere."""
    try:
        name_norm = normalize_name(name)
    except (ValueError, TypeError):
        return False
    h = str(hash_hex or "").strip().lower()
    if not HASH_RE.match(h):
        return False
    try:
        return bool(announces.pin_resolved_name(name_norm, h, source))
    except Exception:
        return False


def unpin(name, announces):
    """Drop a pin, leaving any custom display name on that row intact."""
    try:
        announces.unpin_resolved_name(normalize_name(name))
        return True
    except Exception:
        return False


def list_pins(announces):
    """Return pinned names as {name: {hash, source, first_seen, ...}}."""
    try:
        rows = announces.get_all_resolved_name_pins() or []
    except Exception:
        return {}
    pins = {}
    for row in rows:
        try:
            pins[row["name_norm"]] = {
                "hash": row["destination_hash"],
                "source": row["name_source"],
                "first_seen": str(row["first_seen"]),
                "last_verified": str(row["last_verified"]),
            }
        except Exception:
            continue
    return pins
