const { test, expect } = require("@playwright/test");
const { collectConsoleErrors, collectResponses, STATUS_GATED_KEYS, STATUS_READINESS_KEYS } = require("./helpers");

// Coverage for the sign-in gate on THIS hosted, shared, multi-user instance,
// at the root of msg.quasarke.net. The sign-in gate is the entry here: this
// instance is a shared resource, so the gate is protecting that resource
// rather than authenticating a transport, and there is no browsable
// pre-sign-in product state beyond it. Every test here runs against an
// ephemeral multi-user MeshChatX instance
// (scripts/e2e/start-e2e-multiuser-stack.sh), never against the live
// deployment, before anyone has signed in and with no session cookie sent.
// This is the exact situation a fresh visitor to the hosted instance is in,
// which had zero E2E coverage before this suite: every existing spec under
// tests/e2e ran a local SINGLE-USER stack that never exercises the sign-in
// gate at all.
//
// This is deliberately scoped to the hosted shared instance. It says
// nothing about the Progressive Web App, a different rung where the
// identity lives on the person's own device, there is no shared server to
// guard, and reaching the full app with no session is the correct, intended
// behaviour rather than a bug. Do not widen these assertions to claim "no
// session" is unsafe in general.
//
// These tests are written to a contract a parallel change is landing to
// satisfy. Several of them fail against the current code (the shell renders
// underneath the sign-up form, several endpoints are called before anyone
// is signed in, and the multi-session toast and tutorial can appear). That
// is expected until that change lands; it is what this suite exists to prove
// one way or the other.

test.describe("Hosted multi-user sign-in gate: pre sign-in state", () => {
    test("only entry gate content renders: name, description, fields, and actions", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByText(/MeshChatX/i).first()).toBeVisible({ timeout: 30000 });

        // Username and password fields, unlabelled ambiguity avoided by
        // scoping to input elements rather than any text match.
        const usernameField = page.locator('input[autocomplete="username"]');
        const passwordField = page.locator('input[type="password"]').first();
        await expect(usernameField).toBeVisible({ timeout: 30000 });
        await expect(passwordField).toBeVisible();

        // A fresh instance with no accounts yet defaults to the create
        // account flow. Other specs in this project register accounts of
        // their own, and file execution order is not this test's business,
        // so land in create mode explicitly rather than assuming it is the
        // default: both actions named in the contract must be reachable
        // from here, the submit action to create an account, and the toggle
        // to switch to signing in to an account that already exists.
        const createButton = page.getByRole("button", { name: "Create account", exact: true });
        if ((await createButton.count()) === 0) {
            await page.getByRole("button", { name: "I need an account" }).click();
        }
        await expect(createButton).toBeVisible();
        await expect(page.getByRole("button", { name: "I already have an account" })).toBeVisible();
    });

    test("zero authenticated API requests on load, and no response is a 401", async ({ page }) => {
        const collected = collectResponses(page);
        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30000 });
        // Give any stray background call from a still-mounting shell a
        // moment to fire, so this is a real assertion and not a race against
        // requests that simply have not gone out yet.
        await page.waitForTimeout(2000);

        const unauthorized = collected.responses.filter((r) => r.status === 401);
        expect(unauthorized, JSON.stringify(unauthorized)).toEqual([]);

        const authenticatedLookingCalls = collected.responses.filter((r) => {
            const path = new URL(r.url).pathname;
            return (
                path.startsWith("/api/v1/app") ||
                path.startsWith("/api/v1/blocked-destinations") ||
                path.startsWith("/api/v1/lxmf") ||
                path.startsWith("/api/v1/telephone") ||
                path.startsWith("/api/v1/config") ||
                path.startsWith("/api/v1/plugins") ||
                path.startsWith("/api/v1/notifications") ||
                path.startsWith("/api/v1/rrc")
            );
        });
        expect(authenticatedLookingCalls, JSON.stringify(authenticatedLookingCalls)).toEqual([]);
    });

    test("/api/v1/status is public, 200, readiness fields only, none of the gated fields", async ({ request }) => {
        const res = await request.get("/api/v1/status");
        expect(res.status()).toBe(200);
        const body = await res.json();

        for (const key of STATUS_READINESS_KEYS) {
            expect(body, `missing readiness field: ${key}`).toHaveProperty(key);
        }
        const leaked = STATUS_GATED_KEYS.filter((key) => key in body);
        expect(leaked, `unauthenticated /api/v1/status leaked: ${leaked.join(", ")}`).toEqual([]);
    });

    test("no shell chrome: no nav rail, no compose, no sync messages, no telephone, no command palette", async ({
        page,
    }) => {
        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30000 });

        const navRail = page.locator("div.fixed.inset-y-0.left-0").filter({ has: page.locator("ul.py-3") });
        await expect(navRail).toHaveCount(0);

        await expect(page.getByTestId("header-command-palette")).toHaveCount(0);
        await expect(page.getByTestId("header-telephone")).toHaveCount(0);
        await expect(page.getByTestId("header-relay-chat")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Compose", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Sync Messages", exact: true })).toHaveCount(0);

        // The command palette shortcut must not do anything when only the
        // entry gate is mounted; there is no shell for it to search.
        await page.keyboard.press("Control+k");
        await expect(page.getByPlaceholder(/Search commands,\s*(routes|navigate),\s*or peers/i)).toHaveCount(0);
    });

    test("no Anonymous Peer identity widget", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText("Anonymous Peer")).toHaveCount(0);
    });

    test("no multi-session warning toast", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(1500);
        await expect(page.getByText(/Multiple active sessions/i)).toHaveCount(0);
    });

    test("no TutorialModal feature tour", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole("button", { name: "Skip Setup" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    });

    test("no What's New changelog panel", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText("What's New", { exact: true })).toHaveCount(0);
    });

    test("no uncaught console errors on load", async ({ page }) => {
        const consoleState = collectConsoleErrors(page);
        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(1500);
        expect(consoleState.errors, JSON.stringify(consoleState.errors)).toEqual([]);
    });

    test("regression guard: boot gate never times out or reports a startup error against a healthy backend", async ({
        page,
    }) => {
        await page.goto("/");
        // The old bug polled /api/v1/status for the full two minute timeout
        // because an auth-error body with no "status" key was read as
        // "still starting". A healthy backend must mount the gate in well
        // under that, and must never flip the boot splash into its error
        // state or print the timeout line.
        const splash = page.locator("#meshchatx-boot-splash");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15000 });
        if ((await splash.count()) > 0) {
            await expect(splash).not.toHaveAttribute("data-state", "error");
        }
        await expect(page.getByText(/Network startup timed out/i)).toHaveCount(0);
    });
});
