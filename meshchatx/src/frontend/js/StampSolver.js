// SPDX-License-Identifier: 0BSD

import { loadStampWasm } from "./StampWasmLoader.js";

// Iterations tried per wasm call before yielding back to the event loop.
// Large enough to keep overhead low, small enough that a single batch never
// blocks the main thread for more than roughly a frame or two even on weak
// hardware (measured well under 100ms per batch on desktop V8 at the
// default cost; see the stamp auth notes for the full timing pass).
const BATCH_SIZE = 5000;

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Solve an LXMF stamp for a challenge shaped like the one
 * /api/v1/auth/stamp/challenge and /api/v1/multiuser/status hand out:
 * { material, cost, expand_rounds, expires_at, signature }.
 *
 * Runs the search in batches, yielding to the event loop between them so
 * the page can paint and stay responsive instead of freezing for however
 * long the solve takes. Calls onProgress({ attempts, elapsedMs }) after
 * every batch. There is deliberately no percentage: solve time is a
 * geometric random variable (find the first random 32 bytes that hash
 * under a target), not a countdown, so the only honest things to show are
 * "how long so far" and "how many tried", not "how much is left".
 *
 * Throws "stamp_wasm_unavailable" when the wasm module could not be
 * loaded (WebAssembly unsupported, fetch failed, SRI mismatch, ...).
 */
export async function solveStamp(challenge, onProgress) {
    const wasm = await loadStampWasm();
    if (!wasm) {
        throw new Error("stamp_wasm_unavailable");
    }
    const material = hexToBytes(challenge.material);
    const solver = new wasm.StampSolver(material, challenge.cost, challenge.expand_rounds);
    const start = performance.now();
    for (;;) {
        const stamp = solver.solve_batch(BATCH_SIZE);
        const elapsedMs = performance.now() - start;
        if (typeof onProgress === "function") {
            onProgress({ attempts: Number(solver.attempts), elapsedMs });
        }
        if (stamp) {
            return bytesToHex(stamp);
        }
        // Yield so the browser can paint the progress update and stay
        // responsive to input between batches.

        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}
