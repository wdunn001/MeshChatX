const { test, expect } = require("@playwright/test");
const { freshAccountCredentials, registerViaUi, dismissHostedWelcomeCard } = require("./helpers");
const { e2ePatch } = require("../helpers");

// Contract point 9: after a successful sign in or account creation, the full
// shell mounts with the user's identity. Registration on the ephemeral
// multi-user instance also exercises the LXMF stamp captcha
// (MESHCHAT_STAMP_AUTH_ENABLED=1 in scripts/e2e/start-e2e-multiuser-stack.sh,
// at a lowered MESHCHAT_STAMP_AUTH_COST so solving it stays fast in CI), so
// registering here is also the coverage for "the LXMF stamp captcha when
// required" from contract point 1.
//
// Every account created by these tests lives only on the throwaway backend
// this file's Playwright project boots for itself; nothing here ever talks
// to the live msg.quasarke.net instance.

test.describe("Hosted multi-user account lifecycle", () => {
    test("creating an account mounts the full shell with the new identity", async ({ page }) => {
        const credentials = freshAccountCredentials();
        await registerViaUi(page, credentials);

        // Registration reloads the page (window.location.href = "/") to drop
        // any state from before sign in, so wait for the shell to reappear
        // fresh rather than assuming the same document.
        await expect(page.getByTestId("header-command-palette")).toBeVisible({ timeout: 30000 });

        // A brand new account meets the hosted welcome card first. Close it so
        // this test is about the shell rather than the card, which has its own
        // spec.
        await dismissHostedWelcomeCard(page);
        // Scoped to the identity widget on purpose. The sign out row in the
        // same footer names the account too, so a bare text match finds more
        // than one element and says nothing about which surface is right.
        await expect(page.getByTestId("sidebar-account-chip").getByText(credentials.username)).toBeVisible({
            timeout: 20000,
        });

        // The sign-in gate must be gone now that a shell is mounted.
        await expect(page.locator('input[autocomplete="username"]')).toHaveCount(0);
    });

    test("signing in to an existing account mounts the full shell with that identity", async ({ page, context }) => {
        const credentials = freshAccountCredentials();
        await registerViaUi(page, credentials);
        await expect(page.getByTestId("header-command-palette")).toBeVisible({ timeout: 30000 });

        // Simulate a fresh pre-sign-in visit to this hosted shared instance:
        // drop the session this browser context picked up from registering,
        // then reload.
        await context.clearCookies();
        await page.goto("/");

        const usernameField = page.locator('input[autocomplete="username"]');
        await expect(usernameField).toBeVisible({ timeout: 20000 });
        // An instance with at least one account defaults to sign in, not
        // create, so the sign-in action is the one already on screen.
        await expect(page.getByRole("button", { name: "I already have an account" })).toHaveCount(0);

        await usernameField.fill(credentials.username);
        await page.locator('input[type="password"]').first().fill(credentials.password);
        const loginCall = page.waitForResponse(
            (r) => r.url().includes("/api/v1/multiuser/login") && r.request().method() === "POST",
            { timeout: 30000 }
        );
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        const loginResponse = await loginCall;
        expect(loginResponse.status(), await loginResponse.text().catch(() => "")).toBe(200);

        await expect(page.getByTestId("header-command-palette")).toBeVisible({ timeout: 30000 });
        await dismissHostedWelcomeCard(page);
        await expect(page.getByTestId("sidebar-account-chip").getByText(credentials.username)).toBeVisible({
            timeout: 20000,
        });
        await expect(usernameField).toHaveCount(0);
    });

    test("sign-up sets the RNS/LXMF display name to the username, and it can be changed afterwards", async ({
        page,
    }) => {
        // Nobody should end up announcing on the mesh as "Anonymous Peer"
        // just because they signed up through the hosted gate rather than
        // picking a name in a desktop-only onboarding flow. The username
        // collected at sign up is the sane default identity, and it is a
        // default, not a lock: the person can still rename themselves
        // afterwards the same way a single-user install always could.
        const credentials = freshAccountCredentials();
        await registerViaUi(page, credentials);
        await expect(page.getByTestId("header-command-palette")).toBeVisible({ timeout: 30000 });

        const configRes = await page.request.get("/api/v1/config");
        expect(configRes.ok(), await configRes.text().catch(() => "")).toBeTruthy();
        const configBody = await configRes.json();
        expect(configBody.config?.display_name).toBe(credentials.username);
        expect(configBody.config?.display_name).not.toBe("Anonymous Peer");

        // The identity widget in the shell reflects it too, not just the API.
        await dismissHostedWelcomeCard(page);
        await expect(page.getByTestId("sidebar-account-chip").getByText(credentials.username)).toBeVisible({
            timeout: 10000,
        });

        const renamedTo = `${credentials.username}-renamed`;
        const patchRes = await e2ePatch(page.request, `${new URL(page.url()).origin}/api/v1/config`, {
            display_name: renamedTo,
        });
        expect(patchRes.ok(), await patchRes.text().catch(() => "")).toBeTruthy();
        const patchBody = await patchRes.json();
        expect(patchBody.config?.display_name).toBe(renamedTo);
    });
});
