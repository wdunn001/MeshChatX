#!/usr/bin/env bash
# Run the hosted MULTI-USER entry gate Playwright suite in CI, against an
# ephemeral multi-user backend + Vite dev server started fresh for this run.
# Mirrors scripts/ci/github-e2e.sh, pointed at playwright.multiuser.config.js
# instead of the single-user config, so it never touches the single-user
# stack or the live hosted instance.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export CI=1
export MESHCHAT_SKIP_STORAGE_LOCK=1
export E2E_MU_BACKEND_PORT="${E2E_MU_BACKEND_PORT:-18081}"
export E2E_MU_VITE_HOST="${E2E_MU_VITE_HOST:-127.0.0.1}"
export E2E_MU_VITE_PORT="${E2E_MU_VITE_PORT:-5273}"

pnpm exec playwright install chromium --with-deps

pnpm exec playwright test --config=playwright.multiuser.config.js
