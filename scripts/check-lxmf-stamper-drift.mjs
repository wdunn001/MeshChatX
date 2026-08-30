#!/usr/bin/env node
// SPDX-License-Identifier: 0BSD
/**
 * Network-gated check: has ratspeak/rsLXMF's stamper algorithm changed
 * upstream since lxmf-stamper-wasm/src/lib.rs last synced its copy?
 *
 * lxmf-stamper-wasm/src/lib.rs carries a hand-synced copy of the four core
 * functions in rsLXMF's crates/lxmf-core/src/stamper.rs, rather than a live
 * Cargo dependency: measured (2026-08-30) that `lxmf-core` cannot be
 * consumed as a bare git/registry dependency at all, from any project
 * outside its own checkout -- rsLXMF's workspace Cargo.toml wires rns-crypto
 * / rns-wire / rns-identity / rns-link / rns-protocol / rns-transport via
 * relative `../rsReticulum/crates/...` path deps, so `cargo build` against
 * a git dependency on lxmf-core fails immediately with
 * "no matching package named `rns-crypto`" -- independent of wasm size (a
 * real dependency was also measured to produce a *smaller* wasm artifact
 * than this copy, 62KB vs 70KB raw, so size is not why the copy exists).
 *
 * Because there is no live dependency to catch upstream algorithm drift
 * automatically, this script is the substitute: it fetches stamper.rs at a
 * pinned commit and SHA-256-hashes the whole file, comparing against the
 * hash recorded below. Run manually (or as a periodic/scheduled job, NOT
 * part of the default `task check` gate, since it needs network) before
 * relying on the copy for anything security-sensitive, and whenever bumping
 * PINNED_COMMIT. A mismatch does not necessarily mean the *algorithm*
 * changed (could be a comment/doc/refactor); read the diff at the printed
 * URL and decide whether lib.rs needs re-syncing, then update
 * EXPECTED_STAMPER_SHA256 (and PINNED_COMMIT, if bumping) once you have.
 *
 * lxmf-stamper-wasm/src/lib.rs also carries hermetic known-answer-vector
 * tests (`cargo test`, `stamper_cross_validation` module) cross-validated
 * against the live Python `LXMF.LXStamper` this server actually enforces
 * against; those catch local regressions to the copy on every test run,
 * with no network needed. This script covers the other half of the risk:
 * upstream changing out from under an unchanged copy.
 */
import crypto from "node:crypto";
import process from "node:process";

const REPO = "ratspeak/rsLXMF";
const FILE_PATH = "crates/lxmf-core/src/stamper.rs";

// Bump these together after reviewing the diff at:
//   https://github.com/ratspeak/rsLXMF/commits/main/crates/lxmf-core/src/stamper.rs
// and re-syncing lxmf-stamper-wasm/src/lib.rs (+ its KAT tests) if the
// algorithm itself changed.
const PINNED_COMMIT = "e210e0c244c76532faae99696f83c94d44c27dc6";
const EXPECTED_STAMPER_SHA256 = "ac85245777622ffa89971a60ce084f0c31d5bd37eaa55ef233a651ead3dbb332";

const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${PINNED_COMMIT}/${FILE_PATH}`;
const COMPARE_URL = `https://github.com/${REPO}/compare/${PINNED_COMMIT}...main`;

async function main() {
    if (process.env.LXMF_STAMPER_DRIFT_SKIP === "1") {
        console.log("check-lxmf-stamper-drift: LXMF_STAMPER_DRIFT_SKIP=1, skipping.");
        process.exit(0);
    }

    const requireCheck =
        process.env.MESHCHATX_REQUIRE_LXMF_STAMPER_DRIFT_CHECK === "1" ||
        process.env.MESHCHATX_REQUIRE_LXMF_STAMPER_DRIFT_CHECK === "true";

    let text;
    try {
        const res = await fetch(RAW_URL, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        text = await res.text();
    } catch (err) {
        const msg = `check-lxmf-stamper-drift: could not fetch ${RAW_URL} (${err.message}). Network-gated check, skipping.`;
        if (requireCheck) {
            console.error(msg);
            process.exit(1);
        }
        console.warn(msg);
        process.exit(0);
    }

    const actualHash = crypto.createHash("sha256").update(text, "utf8").digest("hex");

    if (actualHash !== EXPECTED_STAMPER_SHA256) {
        console.error("check-lxmf-stamper-drift: MISMATCH");
        console.error(`  pinned commit:  ${PINNED_COMMIT}`);
        console.error(`  expected sha256: ${EXPECTED_STAMPER_SHA256}`);
        console.error(`  actual sha256:   ${actualHash}`);
        console.error("");
        console.error(
            "stamper.rs at the pinned commit no longer matches what this check last recorded. " +
                "Either the pin was bumped without updating this script, or upstream changed the " +
                "file. Review the diff, and if the algorithm changed, re-sync the copy in " +
                "lxmf-stamper-wasm/src/lib.rs (all four functions) and its KAT tests before " +
                "trusting stamps against a newer live server:",
        );
        console.error(`  ${COMPARE_URL}`);
        process.exit(1);
    }

    console.log("check-lxmf-stamper-drift: ok, upstream stamper.rs unchanged at pinned commit.");
    console.log(`  pinned commit: ${PINNED_COMMIT}`);
}

main();
