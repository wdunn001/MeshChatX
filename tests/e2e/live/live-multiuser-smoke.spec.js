const { test, expect } = require("@playwright/test");

// Read-only smoke check against the REAL hosted instance. Opt-in only: it
// runs solely when E2E_LIVE_SMOKE=1 is set, and it is excluded from both the
// default "chromium" project and the "multiuser" project's testDir, so a
// plain `playwright test` run never reaches it. This file must never
// register an account or sign in against the live instance; it only reads
// what a browser sees before signing in, the same request the bug report
// that started this suite was filed against. This instance is a shared
// resource, so the sign-in gate IS the entry here; that framing is specific
// to this hosted shared instance and says nothing about the Progressive Web
// App, where a local, on-device identity with no session is the intended,
// login-free product state rather than a gap.
//
// Run it explicitly with:
//   E2E_LIVE_SMOKE=1 pnpm exec playwright test --config=playwright.live.config.js
//
// or via the manually-triggered "E2E multiuser live smoke" GitHub Actions
// workflow (workflow_dispatch only, never on push or pull_request).

const RUN_LIVE = process.env.E2E_LIVE_SMOKE === "1";

test.describe("Live hosted instance smoke (read-only, opt-in)", () => {
    test.skip(!RUN_LIVE, "Set E2E_LIVE_SMOKE=1 to run this against the live hosted instance.");

    test("pre sign-in load shows only the sign-in gate, with no 401s and no console errors", async ({ page }) => {
        const responses = [];
        const consoleErrors = [];
        page.on("response", (response) => {
            responses.push({ url: response.url(), status: response.status() });
        });
        page.on("pageerror", (err) => consoleErrors.push(String(err && err.message ? err.message : err)));
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                consoleErrors.push(msg.text());
            }
        });

        await page.goto("/");
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20000 });

        const unauthorized = responses.filter((r) => r.status === 401);
        expect(unauthorized, JSON.stringify(unauthorized)).toEqual([]);
        expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([]);

        const navRail = page.locator("div.fixed.inset-y-0.left-0").filter({ has: page.locator("ul.py-3") });
        await expect(navRail).toHaveCount(0);
        await expect(page.getByText("Anonymous Peer")).toHaveCount(0);
        await expect(page.getByText(/Multiple active sessions/i)).toHaveCount(0);

        // No mutating action anywhere in this test: no fill, no submit, no
        // register/login call. The page is only ever read.
    });
});
