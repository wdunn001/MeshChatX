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
