#!/usr/bin/env bash
set -euo pipefail

# Ephemeral MULTI-USER MeshChatX instance for the hosted entry gate E2E suite
# (tests/e2e/multiuser). Mirrors start-e2e-stack.sh, with two differences:
#
#   1. MESHCHAT_MULTIUSER=1 so the instance boots in accounts mode, the same
#      mode the live hosted instance at msg.quasarke.net runs in. Nothing in
#      this suite ever touches that live instance; this is a throwaway
#      backend + Vite pair on its own ports so account creation tests have
#      somewhere safe to register real accounts.
#   2. The LXMF stamp captcha is turned on (MESHCHAT_STAMP_AUTH_ENABLED=1),
#      the same gate the hosted instance runs, but at MESHCHAT_STAMP_AUTH_COST=1
#      instead of the production default of 17. Cost 17 is deliberately
#      expensive (multiple seconds of proof of work); cost 1 exercises the
#      exact same challenge/solve/verify path in well under a second, so the
#      suite still proves the captcha is present and wired up without paying
#      for its difficulty on every run. Never lower this against the live
#      deployment; it is only set here, for this ephemeral process.
#
# Ports default away from both the single-user E2E stack (18079 / 5173) and a
# normal dev server (8000), so the two stacks can run side by side.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export E2E_MU_BACKEND_PORT="${E2E_MU_BACKEND_PORT:-18081}"
export MESHCHAT_NO_HTTPS=1
export MESHCHAT_LANDLOCK=0
export MESHCHAT_MULTIUSER=1
export MESHCHAT_STAMP_AUTH_ENABLED=1
export MESHCHAT_STAMP_AUTH_HMAC_KEY="${MESHCHAT_STAMP_AUTH_HMAC_KEY:-e2e-multiuser-stamp-key-not-for-production}"
export MESHCHAT_STAMP_AUTH_COST="${MESHCHAT_STAMP_AUTH_COST:-1}"
BACKEND_PORT="$E2E_MU_BACKEND_PORT"
VITE_HOST="${E2E_MU_VITE_HOST:-127.0.0.1}"
VITE_PORT="${E2E_MU_VITE_PORT:-5273}"

TMPDIR="$(mktemp -d -t meshchat-e2e-mu-XXXXXX)"
export MESHCHAT_LOG_DIR="$TMPDIR/logs"
mkdir -p "$MESHCHAT_LOG_DIR"

cleanup() {
    if [[ -n "${BACK_PID:-}" ]] && kill -0 "$BACK_PID" 2>/dev/null; then
        kill "$BACK_PID" 2>/dev/null || true
        wait "$BACK_PID" 2>/dev/null || true
    fi
    rm -rf "$TMPDIR"
}

trap cleanup EXIT INT TERM

echo "E2E multiuser: starting MeshChat backend on 127.0.0.1:${BACKEND_PORT} (isolated storage under ${TMPDIR})"

uv run python -m meshchatx.meshchat \
    --headless \
    --no-https \
    --host 127.0.0.1 \
    --port "${BACKEND_PORT}" \
    --storage-dir "$TMPDIR/storage" \
    --reticulum-config-dir "$TMPDIR/rns" \
    &
BACK_PID=$!

echo "E2E multiuser: waiting for /api/v1/status network_ready..."
ready=0
for i in $(seq 1 240); do
    if ! kill -0 "$BACK_PID" 2>/dev/null; then
        echo "E2E multiuser: backend process exited before becoming ready"
        exit 1
    fi
    if body="$(curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/status" 2>/dev/null)"; then
        if printf '%s' "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("status")=="ok" or d.get("network_ready") else 1)'; then
            ready=1
            echo "E2E multiuser: backend ready after ${i}s"
            break
        fi
    fi
    sleep 1
done

if [[ "$ready" -ne 1 ]]; then
    echo "E2E multiuser: backend did not respond on :${BACKEND_PORT} within 240s"
    exit 1
fi

# The unauthenticated status check above is the exact regression this suite
# guards: it must succeed without a session, and it must not be the full
# signed-in payload. Fail fast here rather than let a quieter assertion
# inside a spec explain it later.
if body="$(curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/status" 2>/dev/null)"; then
    if printf '%s' "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(1 if "listen_port" in d else 0)'; then
        :
    else
        echo "E2E multiuser: unauthenticated /api/v1/status leaked a gated field (listen_port); refusing to proceed"
        exit 1
    fi
fi

echo "E2E multiuser: starting Vite on ${VITE_HOST}:${VITE_PORT}"
export MESHCHAT_VUE_DEVTOOLS=0
export E2E_BACKEND_PORT="${BACKEND_PORT}"
pnpm exec vite --host "${VITE_HOST}" --port "${VITE_PORT}" &
VITE_PID=$!
wait "$VITE_PID"
