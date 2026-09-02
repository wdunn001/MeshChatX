const { test, expect } = require("@playwright/test");

// Critical constraint on the hosted multi-user entry gate rewrite: the
// single-user desktop entry (App.vue rendering the "auth" route bare, with
// no shell chrome underneath it, exactly as it already does today) must not
// change. This runs against the existing single-user E2E stack
// (scripts/e2e/start-e2e-stack.sh), the same backend every other spec in
// tests/e2e uses, not the multi-user stack tests/e2e/multiuser depends on.
//
// Two things about that shared stack shape these tests:
//
//   1. It is headless with no auth mode ever chosen (fresh temp storage
//      every run, no MESHCHAT_MULTIUSER), so the very first navigation is
//      first-run and lands on /#/setup-mode rather than wherever it was
//      asked to go (authSessionSync.js's authNavigationTargetForStatus,
//      the `!status.auth_mode && auth_modes_available.includes("accounts")`
//      branch). That surfaced a second instance of the exact bug class this
//      suite exists to catch: /#/setup-mode currently renders wrapped in
//      the full app shell too (nav header, TutorialModal, the changelog
//      panel), the same way /#/accounts does. It shares App.vue's root
//      cause (`<RouterView v-if="$route.name === 'auth'" />` only special
//      cases one route name), so it is covered below even though it is not
//      in this suite's contract.
//
//   2. Auth is never enabled on this stack (no --auth / MESHCHAT_AUTH), and
//      AuthPage.vue's own mounted() hook redirects away from /#/auth
//      whenever the backend reports auth_enabled: false, which this stack
//      always does. That is correct, unrelated product behaviour, and
//      fighting it by turning on real auth would mean a second dedicated
//      backend just for one assertion. Intercepting the one API call that
//      decides it (auth_enabled) reaches the same place without that cost:
//      it proves App.vue's actual, unmocked bare-render branch for the
//      "auth" route name, the only thing this second test is about.

test.describe.serial("Single-user desktop entry gate: unchanged", () => {
    test("first-run setup-mode picker also renders bare, with no shell chrome underneath it", async ({ page }) => {
        await page.goto("/#/messages");
        await expect(page).toHaveURL(/#\/setup-mode/, { timeout: 30000 });
        await expect(page.getByText("Who uses this instance?")).toBeVisible({ timeout: 30000 });

        const navRail = page.locator("div.fixed.inset-y-0.left-0").filter({ has: page.locator("ul.py-3") });
        await expect(navRail).toHaveCount(0);
        await expect(page.getByTestId("header-command-palette")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Skip Setup" })).toHaveCount(0);
        await expect(page.getByText("What's New", { exact: true })).toHaveCount(0);
    });

    test("the auth route still renders bare, with no shell chrome underneath it", async ({ page }) => {
        await page.route("**/api/v1/auth/status", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    auth_enabled: true,
                    password_set: true,
                    authenticated: false,
                    stamp_auth_enabled: false,
                    demo_mode: false,
                    auth_page_hint: "",
                }),
            });
        });

        await page.goto("/#/auth");
        await expect(page).toHaveURL(/#\/auth/);

        // AuthPage.vue's own content: single password field, no username
        // field (this is the single shared-password login, not accounts).
        await expect(page.locator("#password")).toBeVisible({ timeout: 30000 });
        await expect(page.locator('input[autocomplete="username"]')).toHaveCount(0);

        // No shell chrome rendered underneath the bare auth page.
        const navRail = page.locator("div.fixed.inset-y-0.left-0").filter({ has: page.locator("ul.py-3") });
        await expect(navRail).toHaveCount(0);
        await expect(page.getByTestId("header-command-palette")).toHaveCount(0);
        await expect(page.getByTestId("header-telephone")).toHaveCount(0);
    });
});
