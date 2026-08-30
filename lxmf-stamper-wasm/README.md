# lxmf-stamper-wasm

Small standalone wasm-bindgen wrapper around the LXMF stamp (proof-of-work)
primitives used to gate MeshChatX sign up and sign in when stamp auth is
enabled (`meshchatx/src/backend/stamp_auth.py`), replacing the ALTCHA
captcha this project used to ship.

## Why a separate crate

`stamp_workblock` / `stamp_valid` / `stamp_value` / a batched `generate_stamp`
are a synced copy of `rsLXMF/crates/lxmf-core/src/stamper.rs` (see the doc
comment in `src/lib.rs`), not an import of `lxmf-core` itself: that crate
pulls in tokio, rns-link, and rns-transport, none of which build for
`wasm32-unknown-unknown`, and the point of this crate is to be small (the
compiled artifact is ~70KB / ~28KB gzipped) since it ships on the onboarding
path over slow radio links. It depends directly on `sha2` + `hkdf` (the same
crates `rns_crypto::sha`/`rns_crypto::hkdf` wrap) rather than on
`rns-crypto`, to avoid pulling in `ed25519-dalek`/`x25519-dalek` (identity
and session crypto this stamper never touches) and the legacy
`getrandom` 0.2 shim they'd otherwise require for wasm.

Before this crate was written, a Rust ↔ Python cross-implementation GATE
test confirmed the workblock construction and stamp validation are
byte-for-byte identical between `rsLXMF`'s Rust stamper and the live
`LXMF.LXStamper` Python implementation this server verifies against, across
several material lengths, costs, and expand_rounds (including the
production defaults, 3000 and 1000). Keep this file's four core functions
byte-for-byte identical to `stamper.rs` if that file changes upstream, and
re-run an equivalent cross-check before touching the hashing/encoding
internals.

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
