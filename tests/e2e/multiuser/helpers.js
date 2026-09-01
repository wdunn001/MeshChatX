const crypto = require("crypto");
const { expect } = require("@playwright/test");

const E2E_MU_BACKEND_PORT = process.env.E2E_MU_BACKEND_PORT || "18081";
const E2E_MU_BACKEND_ORIGIN = `http://127.0.0.1:${E2E_MU_BACKEND_PORT}`;

/** Readiness-only fields an unauthenticated /api/v1/status caller may see. */
const STATUS_READINESS_KEYS = ["status", "stage", "network_ready", "network_degraded", "ui_ready"];

/** Fields that only belong on the signed-in /api/v1/status payload. */
const STATUS_GATED_KEYS = [
    "listen_host",
    "listen_port",
    "https_enabled",
    "plugins_enabled",
    "demo_mode",
    "landlock_kernel_supported",
    "landlock_active",
    "appcontainer_active",
    "seccomp_kernel_supported",
];

/**
 * A fresh username/password pair for a throwaway account on the ephemeral
 * multi-user E2E instance. Never used against the live hosted instance.
 * @returns {{ username: string, password: string }}
 */
function freshAccountCredentials() {
    const suffix = crypto.randomBytes(6).toString("hex");
    return {
        username: `e2e-${suffix}`,
        password: `e2e-pass-${suffix}-correct-horse`,
    };
}

/**
 * Starts collecting every response the page receives from the moment this is
 * called. Callers read `.responses` after the load they care about has
 * settled. Used to assert zero authenticated (401) calls happen while the
 * entry gate is the only thing on screen.
 * @param {import('@playwright/test').Page} page
 * @returns {{ responses: { url: string, status: number }[] }}
 */
function collectResponses(page) {
    const state = { responses: [] };
    page.on("response", (response) => {
        state.responses.push({ url: response.url(), status: response.status() });
    });
    return state;
}

/**
 * Collects uncaught page errors and console "error" level messages from the
 * moment this is called, for asserting a clean load.
 * @param {import('@playwright/test').Page} page
 * @returns {{ errors: string[] }}
 */
function collectConsoleErrors(page) {
    const state = { errors: [] };
    page.on("pageerror", (err) => {
        state.errors.push(String(err && err.message ? err.message : err));
    });
    page.on("console", (msg) => {
        if (msg.type() === "error") {
            state.errors.push(msg.text());
        }
    });
    return state;
}

/**
 * Registers a fresh account through the real sign-in gate UI: fills the
 * form, submits, and waits out the LXMF stamp captcha round trip
 * (MESHCHAT_STAMP_AUTH_ENABLED=1 in scripts/e2e/start-e2e-multiuser-stack.sh,
 * at a lowered MESHCHAT_STAMP_AUTH_COST so solving it stays fast in CI).
 * Leaves the page signed in, mid the full-page reload the app does on
 * successful sign up. Shared by every spec that needs a real account on
 * this ephemeral instance, since which account is first ever created
 * matters here: the account store outside of this suite (accounts.py)
 * makes the very first account admin no matter what role was asked for, and
 * every one after that whatever the caller requested (ROLE_USER for the
 * public sign-up endpoint this function drives).
 * @param {import('@playwright/test').Page} page
 * @param {{ username: string, password: string }} credentials
 */
async function registerViaUi(page, { username, password }) {
    await page.goto("/");
    const usernameField = page.locator('input[autocomplete="username"]');
    await expect(usernameField).toBeVisible({ timeout: 30000 });

    // A fresh instance with no accounts defaults to the create-account form
    // already; if an earlier registration in this run left accounts behind,
    // land in sign-in mode instead, so switch to create explicitly either
    // way.
    const createButton = page.getByRole("button", { name: "Create account", exact: true });
    if ((await createButton.count()) === 0) {
        await page.getByRole("button", { name: "I need an account" }).click();
    }

    await usernameField.fill(username);
    await page.locator('input[type="password"]').first().fill(password);

    const stampChallenge = page.waitForResponse(
        (r) => r.url().includes("/api/v1/auth/stamp/challenge") && r.request().method() === "GET",
        { timeout: 15000 }
    );
    const registerCall = page.waitForResponse(
        (r) => r.url().includes("/api/v1/multiuser/register") && r.request().method() === "POST",
        { timeout: 30000 }
    );
    await page.getByRole("button", { name: "Create account", exact: true }).click();

    const challengeResponse = await stampChallenge;
    expect(challengeResponse.status(), "stamp challenge must be issued during account creation").toBe(200);

    const registerResponse = await registerCall;
    expect(registerResponse.status(), await registerResponse.text().catch(() => "")).toBe(200);
    const registerBody = await registerResponse.request().postDataJSON();
    expect(registerBody).toHaveProperty("stamp_proof");
}

/**
 * Closes the hosted welcome card a brand new account meets on its first sign
 * in. It is a modal over the shell that also names the identity, so a spec
 * that leaves it up cannot click anything underneath it and cannot match the
 * username without hitting two elements. Specs about the card itself assert
 * on it before calling this.
 * @param {import('@playwright/test').Page} page
 */
async function dismissHostedWelcomeCard(page) {
    const card = page.getByTestId("hosted-welcome-card");
    if ((await card.count()) === 0) {
        return;
    }
    // The acknowledgement is stored per identity on the server, so wait for
    // that call rather than only for the card to leave the screen. A caller
    // that clears cookies straight afterwards would otherwise race it and see
    // the card again on the next sign in.
    const seenCall = page.waitForResponse(
        (r) => r.url().includes("/api/v1/app/hosted-onboarding/welcome/seen") && r.request().method() === "POST",
        { timeout: 15000 }
    );
    await page.getByTestId("hosted-welcome-close").click();
    const seenResponse = await seenCall;
    expect(seenResponse.status(), await seenResponse.text().catch(() => "")).toBe(200);
    await expect(card).toHaveCount(0, { timeout: 10000 });
}

module.exports = {
    E2E_MU_BACKEND_ORIGIN,
    STATUS_READINESS_KEYS,
    STATUS_GATED_KEYS,
    freshAccountCredentials,
    collectResponses,
    collectConsoleErrors,
    registerViaUi,
    dismissHostedWelcomeCard,
};
