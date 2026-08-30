#!/usr/bin/env node
/**
 * Builds lxmf-stamper-wasm (Rust) and copies artifacts into frontend public
 * vendor/. Writes integrity.json with SHA-384 SRI hashes. Mirrors
 * build-visualiser-wasm.mjs's conventions, adapted for cargo + wasm-bindgen.
 *
 * Unlike visualiser-wasm, the prebuilt artifacts ARE committed to the repo
 * (meshchatx/src/frontend/public/vendor/lxmf-stamper-wasm/) rather than
 * gitignored: they gate sign up / sign in when stamp auth is enabled, and
 * not every deploy host is expected to carry a Rust + wasm32-unknown-unknown
 * + wasm-bindgen-cli toolchain the way the CI/build environment carries Go.
 * Run this script (or `task build:lxmf-stamper-wasm`) after changing
 * lxmf-stamper-wasm/src/lib.rs and commit the refreshed vendor/ output.
 *
 * Safe offline: if cargo/wasm-bindgen are missing, exits 0 (keeps the
 * already-committed artifacts) unless MESHCHATX_REQUIRE_LXMF_STAMPER_WASM=1.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CRATE_DIR = path.join(REPO_ROOT, "lxmf-stamper-wasm");
const OUT_DIR = path.join(
    REPO_ROOT,
    "meshchatx",
    "src",
    "frontend",
    "public",
    "vendor",
    "lxmf-stamper-wasm",
);
const WASM_NAME = "lxmf_stamper_wasm_bg.wasm";
const JS_NAME = "lxmf_stamper_wasm.js";
const VERSION = "0.1.0";

function computeSri(buf) {
    return `sha384-${crypto.createHash("sha384").update(buf).digest("base64")}`;
}

function main() {
    if (process.env.LXMF_STAMPER_WASM_SKIP === "1") {
        console.log("build-lxmf-stamper-wasm: LXMF_STAMPER_WASM_SKIP=1, skipping.");
        process.exit(0);
    }

    const requireWasm =
        process.env.MESHCHATX_REQUIRE_LXMF_STAMPER_WASM === "1" ||
        process.env.MESHCHATX_REQUIRE_LXMF_STAMPER_WASM === "true";

    if (!fs.existsSync(path.join(CRATE_DIR, "Cargo.toml"))) {
        const msg = "build-lxmf-stamper-wasm: lxmf-stamper-wasm/Cargo.toml missing, skipping.";
        if (requireWasm) {
            console.error(msg);
            process.exit(1);
        }
        console.warn(msg);
        process.exit(0);
    }

    const cargoCheck = spawnSync("cargo", ["--version"], { encoding: "utf8" });
    const bindgenCheck = spawnSync("wasm-bindgen", ["--version"], { encoding: "utf8" });
    if (cargoCheck.status !== 0 || bindgenCheck.status !== 0) {
        const wasmPath = path.join(OUT_DIR, WASM_NAME);
        const jsPath = path.join(OUT_DIR, JS_NAME);
        if (fs.existsSync(wasmPath) && fs.existsSync(jsPath)) {
            console.log(
                "build-lxmf-stamper-wasm: cargo/wasm-bindgen unavailable, keeping already-committed artifacts.",
            );
            process.exit(0);
        }
        const msg = "build-lxmf-stamper-wasm: cargo or wasm-bindgen not found, and no artifacts present.";
        if (requireWasm) {
            console.error(msg);
            process.exit(1);
        }
        console.warn(msg);
        process.exit(0);
    }

    const build = spawnSync(
        "cargo",
        ["build", "--release", "--target", "wasm32-unknown-unknown"],
        { cwd: CRATE_DIR, encoding: "utf8" },
    );
    if (build.status !== 0) {
        console.error(build.stderr || build.stdout || "cargo build failed");
        process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const rawWasm = path.join(
        CRATE_DIR,
        "target",
        "wasm32-unknown-unknown",
        "release",
        "lxmf_stamper_wasm.wasm",
    );
    const bindgen = spawnSync(
        "wasm-bindgen",
        ["--target", "web", "--out-dir", OUT_DIR, rawWasm],
        { encoding: "utf8" },
    );
    if (bindgen.status !== 0) {
        console.error(bindgen.stderr || bindgen.stdout || "wasm-bindgen failed");
        process.exit(1);
    }

    // wasm-bindgen also writes a .d.ts pair; harmless but not served, leave as is.
    const wasmBuf = fs.readFileSync(path.join(OUT_DIR, WASM_NAME));
    const jsBuf = fs.readFileSync(path.join(OUT_DIR, JS_NAME));
    const integrity = {
        version: VERSION,
        wasm: computeSri(wasmBuf),
        js: computeSri(jsBuf),
        source: "lxmf-stamper-wasm/ (repo root), built via task build:lxmf-stamper-wasm",
    };
    fs.writeFileSync(path.join(OUT_DIR, "integrity.json"), JSON.stringify(integrity, null, 2) + "\n");
    console.log(
        `build-lxmf-stamper-wasm: OK (${wasmBuf.length} bytes WASM, SRI written to vendor/lxmf-stamper-wasm/)`,
    );
}

main();
