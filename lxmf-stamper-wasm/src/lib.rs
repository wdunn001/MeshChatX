//! Small standalone wasm-bindgen wrapper around the LXMF stamp (proof-of-work)
//! primitives, for browser onboarding flows that need to solve a stamp
//! without shipping the whole LXMF/Reticulum node into the page.
//!
//! The four core functions below (`stamp_workblock`, `stamp_value`,
//! `stamp_valid`, batched generation) are a synced copy of
//! `rsLXMF/crates/lxmf-core/src/stamper.rs`. They are copied rather than
//! imported because `lxmf-core` pulls in tokio + rns-link + rns-transport,
//! none of which build for `wasm32-unknown-unknown`; this crate depends
//! only on `rns-crypto` (the same HKDF/SHA256 primitives, real dependency,
//! not reimplemented) plus `rmpv` for the identical msgpack round-index
//! encoding. Cross-implementation correctness of the algorithm itself
//! (HKDF construction, msgpack encoding, SHA-256 comparison) was validated
//! against the live Python LXStamper before this crate was written; keep
//! this file's four functions byte-for-byte identical to stamper.rs if
//! that file changes upstream.

use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

/// Matches `rns_crypto::sha::sha256` (SHA-256 of `data`).
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Matches `rns_crypto::hkdf::hkdf_sha256` (HKDF-SHA256 expand, RFC 5869):
/// `salt = None` uses 32 zero bytes, `info = None` uses an empty context.
fn hkdf_sha256(length: usize, ikm: &[u8], salt: Option<&[u8]>, info: Option<&[u8]>) -> Vec<u8> {
    let hk = hkdf::Hkdf::<Sha256>::new(salt, ikm);
    let mut okm = vec![0u8; length];
    hk.expand(info.unwrap_or(b""), &mut okm)
        .expect("HKDF expand failed");
    okm
}

#[cfg(feature = "panic-hook")]
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// ---------------------------------------------------------------------
// Synced copy of rsLXMF stamper.rs (see module doc above).
// ---------------------------------------------------------------------

fn pack_msgpack_uint(n: usize) -> Vec<u8> {
    let value = rmpv::Value::Integer(rmpv::Integer::from(n as u64));
    let mut buf = Vec::new();
    rmpv::encode::write_value(&mut buf, &value).expect("internal: Vec<u8> write is infallible");
    buf
}

/// Matches Python `LXStamper.stamp_workblock(material, expand_rounds)`.
pub fn stamp_workblock(material: &[u8], expand_rounds: usize) -> Vec<u8> {
    let mut workblock = Vec::with_capacity(expand_rounds * 256);

    for n in 0..expand_rounds {
        let n_packed = pack_msgpack_uint(n);

        let mut salt_input = Vec::with_capacity(material.len() + n_packed.len());
        salt_input.extend_from_slice(material);
        salt_input.extend_from_slice(&n_packed);
        let salt = sha256(&salt_input);

        let chunk = hkdf_sha256(256, material, Some(&salt), None);
        workblock.extend_from_slice(&chunk);
    }

    workblock
}

fn leading_zero_bits(data: &[u8]) -> u32 {
    let mut count = 0u32;
    for &byte in data {
        if byte == 0 {
            count += 8;
        } else {
            count += byte.leading_zeros();
            break;
        }
    }
    count
}

fn stamp_value_from_base(base_hasher: &Sha256, stamp: &[u8; 32]) -> u32 {
    let mut hasher = base_hasher.clone();
    hasher.update(stamp);
    let hash = hasher.finalize();
    leading_zero_bits(&hash)
}

/// Leading zero bits of `SHA-256(workblock || stamp)`. Matches Python `stamp_value()`.
pub fn stamp_value(workblock: &[u8], stamp: &[u8; 32]) -> u32 {
    let mut hasher = Sha256::new();
    hasher.update(workblock);
    stamp_value_from_base(&hasher, stamp)
}

pub fn stamp_valid(stamp: &[u8; 32], cost: u8, workblock: &[u8]) -> bool {
    if cost == 0 {
        return true;
    }
    stamp_value(workblock, stamp) >= cost as u32
}

fn rand_bytes(rng: &mut impl rand::RngCore) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    rng.fill_bytes(&mut bytes);
    bytes
}

// ---------------------------------------------------------------------
// wasm-bindgen surface. Batched so JS can yield to the event loop and
// paint real progress (elapsed time + attempt count) between batches
// instead of blocking the main thread for the whole solve. Intended to
// be run inside a Web Worker.
// ---------------------------------------------------------------------

#[wasm_bindgen]
pub struct StampSolver {
    base_hasher: Sha256,
    rng: rand::rngs::ThreadRng,
    cost: u8,
    attempts: u64,
}

#[wasm_bindgen]
impl StampSolver {
    /// Build a solver for `material` (the message/registration id, as raw
    /// bytes) at the given `cost` and `expand_rounds`. This does the
    /// one-time O(expand_rounds * 256 bytes) workblock hashing up front;
    /// `solve_batch` calls after this are O(1) per attempt.
    #[wasm_bindgen(constructor)]
    pub fn new(material: &[u8], cost: u8, expand_rounds: usize) -> StampSolver {
        let workblock = stamp_workblock(material, expand_rounds);
        let mut base_hasher = Sha256::new();
        base_hasher.update(&workblock);
        StampSolver {
            base_hasher,
            rng: rand::rng(),
            cost,
            attempts: 0,
        }
    }

    /// Try up to `iterations` random 32-byte stamps. Returns the winning
    /// stamp on success, or `undefined` if none of this batch satisfied
    /// `cost`. Call again (looping in JS, e.g. via `setTimeout(0)` or
    /// `requestIdleCallback`) until it returns a stamp.
    pub fn solve_batch(&mut self, iterations: u32) -> Option<Vec<u8>> {
        if self.cost == 0 {
            self.attempts += 1;
            return Some(vec![0u8; 32]);
        }
        for _ in 0..iterations {
            let stamp = rand_bytes(&mut self.rng);
            self.attempts += 1;
            if stamp_value_from_base(&self.base_hasher, &stamp) >= self.cost as u32 {
                return Some(stamp.to_vec());
            }
        }
        None
    }

    /// Total attempts made across all `solve_batch` calls so far, for UI
    /// progress display (attempts/sec, elapsed vs. expected order of
    /// magnitude). There is no meaningful percentage: solve time is a
    /// geometric random variable, not a countdown.
    #[wasm_bindgen(getter)]
    pub fn attempts(&self) -> u64 {
        self.attempts
    }
}

/// One-shot verification helper, mainly for tests/tooling on the wasm
/// side; the real verification of record always happens server-side in
/// Python (`LXStamper.stamp_valid`), never trust the client's own check.
#[wasm_bindgen]
pub fn verify_stamp(material: &[u8], stamp: &[u8], cost: u8, expand_rounds: usize) -> bool {
    if stamp.len() != 32 {
        return false;
    }
    let mut s = [0u8; 32];
    s.copy_from_slice(stamp);
    let workblock = stamp_workblock(material, expand_rounds);
    stamp_valid(&s, cost, &workblock)
}

// ---------------------------------------------------------------------
// Drift-detection safety net.
//
// This crate keeps a synced copy of rsLXMF's stamper algorithm rather than
// depending on `lxmf-core` directly (see README.md for the measured reasons
// why: `lxmf-core` cannot be fetched as a bare git/registry dependency at
// all today, since rsLXMF's workspace Cargo.toml wires its `rns-*` deps via
// relative `../rsReticulum` paths -- a `cargo build` from outside that
// sibling checkout layout fails with "no matching package named
// `rns-crypto`", independent of wasm size).
//
// Because there is no live dependency to catch upstream algorithm changes
// automatically, this module hardcodes known-answer vectors that were
// cross-validated bidirectionally against the live `LXMF.LXStamper` Python
// implementation running in the production meshchatx container on 2026-08-30
// (`docker exec meshchatx python3 -c '...LXStamper...'`), at the real
// production cost (17, the live captcha cost at time of writing) and both a
// small expand_rounds (20, fast to regenerate) and the real production
// default (3000). If a future edit to the four functions above changes
// their output for these fixed inputs, `cargo test` fails immediately and
// loudly, instead of stamps silently failing validation in production.
//
// This does NOT automatically detect ratspeak changing the *upstream*
// algorithm (there is no live dependency to observe that). See
// `scripts/check-lxmf-stamper-drift.mjs` for a network-gated, manually-run
// check against the pinned upstream commit for that half of the risk.
#[cfg(test)]
mod stamper_cross_validation {
    use super::*;

    /// Fixed materials used below, kept as hex strings and decoded at test
    /// time rather than hand-transcribed to byte arrays, so there is no
    /// risk of a transcription typo desyncing this from the exact bytes
    /// passed to the live cross-validation run.
    const MATERIAL_A_HEX: &str = "deadbeef00112233445566778899aabbccddeeff0011223344556677889900aa";
    const MATERIAL_B_HEX: &str = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    fn sha256_hex(data: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(data);
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn workblock_matches_live_python_rounds_20() {
        let material = hex_decode(MATERIAL_A_HEX);
        let wb = stamp_workblock(&material, 20);
        assert_eq!(wb.len(), 20 * 256);
        assert_eq!(
            sha256_hex(&wb),
            "b47260004d515a8b42462c120d5c48eb9c44554566219ab74daea4e26b6235d3",
        );
    }

    /// Production expand_rounds (3000, `STAMP_WORKBLOCK_EXPAND_ROUNDS` in
    /// rsLXMF / `LXStamper.WORKBLOCK_EXPAND_ROUNDS` in Python), a different
    /// material than the rounds=20 vectors so this isn't just re-testing
    /// the same input at a different round count.
    #[test]
    fn workblock_matches_live_python_rounds_3000_production() {
        let material = hex_decode(MATERIAL_B_HEX);
        let wb = stamp_workblock(&material, 3000);
        assert_eq!(wb.len(), 3000 * 256);
        assert_eq!(
            sha256_hex(&wb),
            "3be8b22769008b71c8bf6f12a8623f91031d879603af79229105aef6be7970b5",
        );
    }

    /// A stamp this crate's solver found for `MATERIAL_A_HEX` at cost=17
    /// (the live captcha cost at time of writing), rounds=20, verified
    /// `True` / `stamp_value=17` by the live Python `LXStamper.stamp_valid`
    /// / `stamp_value`. Confirms our stamps are accepted by the real server.
    #[test]
    fn our_generated_stamp_is_valid_and_matches_python_value() {
        let material = hex_decode(MATERIAL_A_HEX);
        let stamp = hex_decode("d675c81aa07d00dbd8f85e9d40a6b8be0c4abbcd194130d1366c805bae2734ca");
        let mut s = [0u8; 32];
        s.copy_from_slice(&stamp);
        let wb = stamp_workblock(&material, 20);
        assert_eq!(stamp_value(&wb, &s), 17);
        assert!(stamp_valid(&s, 17, &wb));
    }

    /// A stamp the live Python `LXStamper.generate_stamp` produced for the
    /// same material/cost/rounds. Confirms this crate accepts a stamp it
    /// did not itself generate, i.e. the reverse direction of the
    /// cross-check above (both directions matter: a one-way match can hide
    /// an asymmetric bug).
    #[test]
    fn python_generated_stamp_validates_here() {
        let material = hex_decode(MATERIAL_A_HEX);
        let stamp = hex_decode("23794be32dec1ca504c8ff6095c44db64dd9da78dd5f9560e51fed02e1aac67d");
        let mut s = [0u8; 32];
        s.copy_from_slice(&stamp);
        let wb = stamp_workblock(&material, 20);
        assert!(stamp_valid(&s, 17, &wb));
    }

    /// Same reverse-direction check at the real production expand_rounds
    /// (3000) and the live cost (17), not just the fast rounds=20 vectors
    /// above.
    #[test]
    fn python_generated_stamp_validates_here_at_production_rounds() {
        let material = hex_decode(MATERIAL_B_HEX);
        let stamp = hex_decode("4c9dc478805ea339113dbe7fe674ee5c1b18a5ef3d012c3c0ce169ef5ac3a363");
        let mut s = [0u8; 32];
        s.copy_from_slice(&stamp);
        let wb = stamp_workblock(&material, 3000);
        assert!(stamp_valid(&s, 17, &wb));
    }

    /// And the forward direction at production rounds: a stamp this
    /// crate's algorithm found, verified `True` by live Python.
    #[test]
    fn our_generated_stamp_valid_at_production_rounds() {
        let material = hex_decode(MATERIAL_B_HEX);
        let stamp = hex_decode("261aa577bf5d277ecaa2eae0df35974f0728c8982fc213907712b89a78d4a51a");
        let mut s = [0u8; 32];
        s.copy_from_slice(&stamp);
        let wb = stamp_workblock(&material, 3000);
        assert_eq!(stamp_value(&wb, &s), 17);
        assert!(stamp_valid(&s, 17, &wb));
    }
}
