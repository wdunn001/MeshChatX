# lxmf-stamper-wasm

Small standalone wasm-bindgen wrapper around the LXMF stamp (proof-of-work)
primitives used to gate MeshChatX sign up and sign in when stamp auth is
enabled (`meshchatx/src/backend/stamp_auth.py`), replacing the ALTCHA
captcha this project used to ship.

## Why a separate crate

`stamp_workblock` / `stamp_valid` / `stamp_value` / a batched `generate_stamp`
are a synced copy of `rsLXMF/crates/lxmf-core/src/stamper.rs` (see the doc
comment in `src/lib.rs`), not an import of `lxmf-core` itself.

This was re-measured on 2026-08-30 (previous wording here claimed `lxmf-core`
"doesn't build for wasm32", which is no longer accurate and wasn't the real
reason). What was actually measured, cargo-building on the same toolchain
used to produce the shipped artifact (`cargo build --release --target
wasm32-unknown-unknown` + `wasm-bindgen --target web`):

- **Size is not the problem.** A minimal wasm-bindgen wrapper depending on
  `lxmf-core` directly (exposing only the stamp solve/verify surface, same
  as this crate) produced a **smaller** artifact than this hand-synced copy:
  62,140 bytes raw / 25,967 bytes gzipped, versus this crate's 70,760 /
  28,487. `lxmf-core` does pull in tokio, rns-link, rns-transport, and the
  ed25519-dalek/x25519-dalek deps of `rns-crypto`, but none of that code is
  reachable from the four stamp functions, and wasm-bindgen plus LTO plus
  release `opt-level = "z"` dead-code-eliminate all of it. (`lxmf-core` does
  now compile for `wasm32-unknown-unknown`, as of a local, not-yet-upstreamed
  `rsLXMF`/`rsReticulum` commit that trims `lxmf-core`'s tokio features and
  cfg-splits two `spawn_blocking` call sites off that target. The currently
  *public* `ratspeak/rsLXMF` `main` still pulls tokio's full feature set,
  which does not build for wasm32 at all.)
- **The real blocker is dependency mechanics, not size.** `lxmf-core` cannot
  be consumed as a bare git or registry dependency from *any* external
  project today, wasm or not. `rsLXMF`'s workspace `Cargo.toml` wires
  `rns-crypto` / `rns-wire` / `rns-identity` / `rns-link` / `rns-protocol` /
  `rns-transport` via relative `../rsReticulum/crates/...` path
  dependencies (the two checkouts are meant to be built as siblings). A
  `cargo build` against `lxmf-core = { git = "...", rev = "..." }` from
  outside that sibling layout fails immediately with the error
  "no matching package named `rns-crypto` found". This is unrelated
  to wasm32 and was verified against the current pinned commit. A path
  dependency is explicitly out for this repo (MeshChatX and rsLXMF/rsReticulum
  are built independently), so there is currently no legitimate way to wire
  `lxmf-core` into this crate's `Cargo.toml` at all, regardless of artifact
  size.

So the copy stays, but not as an unmonitored fork: see "Drift detection"
below for the safety net this implies. If `rsLXMF` ever publishes to
crates.io, or restructures its workspace to use git/registry deps instead of
sibling paths for `rns-*`, this decision should be revisited. The size
numbers above say a real dependency would be a straightforward win once it
is mechanically possible.

It depends directly on `sha2` + `hkdf` (the same
crates `rns_crypto::sha`/`rns_crypto::hkdf` wrap) rather than on
`rns-crypto`, to avoid pulling in `ed25519-dalek`/`x25519-dalek` (identity
and session crypto this stamper never touches) and the legacy
`getrandom` 0.2 shim they'd otherwise require for wasm.

Before this crate was written, a Rust to Python cross-implementation GATE
test confirmed the workblock construction and stamp validation are
byte-for-byte identical between `rsLXMF`'s Rust stamper and the live
`LXMF.LXStamper` Python implementation this server verifies against, across
several material lengths, costs, and expand_rounds (including the
production defaults, 3000 and 1000). Keep this file's four core functions
byte-for-byte identical to `stamper.rs` if that file changes upstream, and
re-run an equivalent cross-check before touching the hashing/encoding
internals.

## Drift detection

There is no live dependency on `rsLXMF` to catch it if the upstream stamp
algorithm changes (see above), so this crate carries two separate checks
instead of one silent assumption that the copy stays in sync:

1. **`cargo test` (hermetic, no network).** `src/lib.rs`'s
   `stamper_cross_validation` module hardcodes known-answer vectors
   generated and verified on 2026-08-30 against the live `LXMF.LXStamper`
   Python implementation running in the production meshchatx container
   (`docker exec meshchatx python3 -c '...LXStamper...'`), at the real
   production cost (17, the live captcha cost at time of writing) and both
   expand_rounds=20 (fast) and the production default 3000, checked in both
   directions (a stamp this crate generates validates in Python; a stamp
   Python generates validates here). If a future edit to the four functions
   changes their output for these fixed inputs, `cargo test` fails
   immediately. Run with `task test:lxmf-stamper-wasm` or
   `cargo test --release` in this directory. This catches local regressions
   to the copy; it cannot catch upstream changing the algorithm out from
   under an unedited copy, since it never talks to `rsLXMF`.
2. **`scripts/check-lxmf-stamper-drift.mjs` (network, manual/periodic, not
   part of the default `task check` gate).** Fetches `stamper.rs` at a
   pinned `ratspeak/rsLXMF` commit and compares its SHA-256 against a hash
   recorded in the script. A mismatch means either the pin was bumped
   without updating the recorded hash, or upstream changed the file; either
   way it fails loudly and points at the diff to review, rather than staying
   silent while the copy quietly goes stale. Run with
   `task check:lxmf-stamper-drift` before relying on the copy for anything
   security-sensitive, or on whatever cadence you'd want to know about an
   upstream stamp algorithm change.

One correctness-relevant divergence from the Python reference worth knowing:
`generate_stamp` here hashes the workblock into a `Sha256` state once, then
clones that cheap mid-state per attempt (only the 32-byte candidate stamp is
hashed per try) rather than rehashing `workblock || stamp` from scratch
every attempt the way `LXStamper.job_simple` does. This is a legitimate
Merkle–Damgård optimization, not a change in output (the GATE test covers
it), but it does mean `expand_rounds` barely affects *solve* time in this
implementation — it only pays for the one-time workblock hash. Difficulty is
controlled almost entirely by `cost` (leading zero bits), not
`expand_rounds`.

## Building

```sh
task build:lxmf-stamper-wasm
# or directly:
node ../scripts/build-lxmf-stamper-wasm.mjs
```

Requires `cargo` with the `wasm32-unknown-unknown` target and a matching
`wasm-bindgen-cli` (pinned to the `wasm-bindgen` crate version in
`Cargo.toml`; a version mismatch fails loudly at `wasm-bindgen` time, not
silently). Output goes to
`meshchatx/src/frontend/public/vendor/lxmf-stamper-wasm/`.

Unlike `visualiser-wasm` (Go), the built `.wasm`/`.js` artifacts **are**
committed to the repo rather than gitignored: not every deploy host is
expected to carry a Rust + wasm32 + wasm-bindgen-cli toolchain, and stamp
auth gates account creation, so it should not silently go missing on a host
that cannot rebuild it. Re-run the build and commit the refreshed
`vendor/lxmf-stamper-wasm/` output (including `integrity.json`) after
changing `src/lib.rs`; `tests/frontend/SriIntegrity.test.js` checks the
committed hashes still match the committed files.

Run `task test:lxmf-stamper-wasm` (hermetic) after any change to
`src/lib.rs`, and `task check:lxmf-stamper-drift` (network) periodically or
before relying on the copy for anything security-sensitive. See
"Drift detection" above.
