// SPDX-License-Identifier: 0BSD

/**
 * Lazy-load the LXMF stamp (proof-of-work) wasm module used to gate sign up
 * and sign in when stamp auth is enabled. Falls back silently (resolves
 * null) when WebAssembly is unavailable or the load fails; the caller
 * decides what that means for the auth flow.
 *
 * Artifacts live under /vendor/lxmf-stamper-wasm/, built from the
 * lxmf-stamper-wasm crate (a small standalone wasm-bindgen wrapper around
 * rsLXMF's stamper, not the whole LXMF/Reticulum node) via
 * task build:lxmf-stamper-wasm. Same vendoring shape as
 * VisualiserWasmLoader.js / MicronWasmLoader.js: a fetched, SRI-checked
 * artifact rather than an npm dependency, because it is a native module
 * built outside the JS toolchain.
 */

let modulePromise = null;
let integrityHashes = null;

/** Computes SHA-384 hash of ArrayBuffer for SRI verification. */
async function computeSriHash(buf) {
    const hash = await crypto.subtle.digest("SHA-384", buf);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
    return `sha384-${base64}`;
}

function baseUrl() {
    const root = import.meta.env.BASE_URL || "/";
    return `${root.replace(/\/?$/, "/")}vendor/lxmf-stamper-wasm`;
}

async function getIntegrityHashes() {
    if (integrityHashes !== null) {
        return integrityHashes;
    }
    try {
        const res = await fetch(`${baseUrl()}/integrity.json`);
        if (!res.ok) return null;
        integrityHashes = await res.json();
        return integrityHashes;
    } catch {
        return null;
    }
}

async function verifySri(buf, expectedHash, name) {
    if (!expectedHash) {
        throw new Error(`Stamp WASM: SRI hash missing for ${name}. Refusing to load untrusted code.`);
    }
    const actualHash = await computeSriHash(buf);
    if (actualHash !== expectedHash) {
        throw new Error(`Stamp WASM: SRI hash mismatch for ${name}. Possible tampering detected. Refusing to execute.`);
    }
}

async function loadModule() {
    if (typeof WebAssembly === "undefined") {
        throw new Error("Stamp WASM: WebAssembly is not available");
    }
    const root = baseUrl();
    const integrity = await getIntegrityHashes();
    if (!integrity?.wasm || !integrity?.js) {
        throw new Error("Stamp WASM: SRI missing (build without wasm vendor files?)");
    }

    const jsRes = await fetch(`${root}/lxmf_stamper_wasm.js`);
    if (!jsRes.ok) {
        throw new Error(`Stamp WASM: fetch failed for glue script (${jsRes.status})`);
    }
    const jsBuf = await jsRes.arrayBuffer();
    await verifySri(jsBuf, integrity.js, "lxmf_stamper_wasm.js");
    const blobUrl = URL.createObjectURL(new Blob([jsBuf], { type: "application/javascript" }));
    let glue;
    try {
        glue = await import(/* @vite-ignore */ blobUrl);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }

    const wasmRes = await fetch(`${root}/lxmf_stamper_wasm_bg.wasm`);
    if (!wasmRes.ok) {
        throw new Error(`Stamp WASM: fetch failed for module (${wasmRes.status})`);
    }
    const wasmBuf = await wasmRes.arrayBuffer();
    await verifySri(wasmBuf, integrity.wasm, "lxmf_stamper_wasm_bg.wasm");

    await glue.default({ module_or_path: wasmBuf });
    if (typeof glue.StampSolver !== "function") {
        throw new Error("Stamp WASM: StampSolver export missing after init");
    }
    return glue;
}

/**
 * Ensures the stamp wasm module is loaded and initialized.
 * Resolves the module namespace (StampSolver, verify_stamp), or null when
 * unavailable or the load failed.
 */
export function loadStampWasm() {
    if (modulePromise === null) {
        modulePromise = loadModule().catch((e) => {
            console.warn(e);
            modulePromise = null;
            return null;
        });
    }
    return modulePromise;
}
