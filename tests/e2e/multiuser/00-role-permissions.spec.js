const { test, expect } = require("@playwright/test");
const { freshAccountCredentials, registerViaUi, collectResponses } = require("./helpers");

// Role-based authorization on the hosted multi-user instance.
// meshchatx/src/backend/multiuser/permissions.py is deny by default: a path
// not explicitly classified as public, user, or contributor is admin only.
// meshchatx/src/backend/multiuser/middleware.py enforces that centrally on
// every request, returning 401 with no session and 403 with a
// `required_role` field when the session's role is too low.
//
// The point of the tests below is the NEGATIVE case: a signed-in ordinary
// user calling a restricted endpoint directly must still be refused, no
// matter what the UI shows or hides. A hidden button is not a permission
// check, so these call the endpoints directly with that user's real session
// rather than inspecting the DOM for an absent control. This is a
// regression guard: it must fail loudly the day anyone widens access to an
// endpoint just to quiet a console error.
//
// `/api/v1/blocked-destinations` is the named case: contributor and admin
// only (an ordinary user is refused, both contributor and admin are
// allowed). It is asserted here as a 403 with required_role "contributor",
// which is what "admin and contributor only" means under role_allows'
// cumulative ranking (a role grants everything the roles before it grant).
// At the time this suite was written that endpoint was still listed under
// USER_PREFIXES in permissions.py, so this test is expected to fail until
// the reclassification lands, the same pattern the rest of this suite
// follows for the entry gate rewrite.
//
// File naming: this file is prefixed "00-" so it sorts, and therefore runs,
// before every other multiuser spec that registers an account (workers: 1
// in playwright.multiuser.config.js makes file order deterministic within
// one run). That matters because accounts.py makes the very first account
// ever created on this ephemeral instance admin no matter what role was
// requested, and every account after that whatever the caller asked for
// (ROLE_USER, for the public sign-up endpoint registerViaUi drives). The
// admin-role assertion right after the first registerViaUi call below is a
// loud, explicit check of that precondition rather than a silent
// assumption: if some other file ever runs first and claims the admin slot
// instead, this test fails with a clear message rather than mis-asserting
// against the wrong account.

// Plain describe, not .serial: the second test must still run and report
// its own result even when the first one fails (expected today, since
// /api/v1/blocked-destinations has not been reclassified yet), rather than
// being skipped the way .serial would skip it after an earlier failure.
// Declaration order alone is enough for the "runs after the first test
// claims the admin slot" property this file's tests rely on, given
// workers: 1 in playwright.multiuser.config.js.
test.describe("Role-based authorization on the hosted multi-user instance", () => {
    test("ordinary user is refused a contributor-or-admin endpoint directly; admin is allowed; unclassified paths deny by default", async ({
        browser,
    }) => {
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();
        const userContext = await browser.newContext();
        const userPage = await userContext.newPage();
        try {
            const adminCreds = freshAccountCredentials();
            await registerViaUi(adminPage, adminCreds);
            await expect(adminPage.getByTestId("header-command-palette")).toBeVisible({ timeout: 30000 });

            const adminMeRes = await adminPage.request.get("/api/v1/multiuser/me");
            expect(adminMeRes.ok(), await adminMeRes.text().catch(() => "")).toBeTruthy();
            const adminMeBody = await adminMeRes.json();
            expect(
                adminMeBody.account?.role,
                "expected the first account registered against this ephemeral instance to be admin " +
                    "(accounts.py). See the file-ordering note at the top of this file if that changed.",
            ).toBe("admin");

            const userCreds = freshAccountCredentials();
            await registerViaUi(userPage, userCreds);
            await expect(userPage.getByTestId("header-command-palette")).toBeVisible({ timeout: 30000 });

            const userMeRes = await userPage.request.get("/api/v1/multiuser/me");
            const userMeBody = await userMeRes.json();
            expect(userMeBody.account?.role).toBe("user");

            // Negative case: the whole point of this test. An ordinary user
            // calling a contributor/admin-only endpoint directly must be
            // refused, independent of anything the UI does or does not show.
            const deniedRes = await userPage.request.get("/api/v1/blocked-destinations");
            expect(deniedRes.status(), await deniedRes.text().catch(() => "")).toBe(403);
            const deniedBody = await deniedRes.json();
            expect(deniedBody.required_role).toBe("contributor");

            // Positive case: the same endpoint succeeds for the admin session.
            const allowedRes = await adminPage.request.get("/api/v1/blocked-destinations");
            expect(allowedRes.status(), await allowedRes.text().catch(() => "")).toBe(200);

            // Deny by default: an endpoint with no entry in PUBLIC_PREFIXES,
            // USER_PREFIXES, or CONTRIBUTOR_PREFIXES is admin only without
            // needing its own line, and this must already hold today
            // regardless of how any one endpoint gets reclassified.
            const denyDefaultRes = await userPage.request.get("/api/v1/interfaces");
            expect(denyDefaultRes.status(), await denyDefaultRes.text().catch(() => "")).toBe(403);
            const denyDefaultBody = await denyDefaultRes.json();
            expect(denyDefaultBody.required_role).toBe("admin");
        } finally {
            await adminContext.close();
            await userContext.close();
        }
    });

    test("an ordinary user's normal shell session produces no 401 or 403 noise", async ({ browser }) => {
        // The negative case above is the important half, but the two must
        // not be confused: a role system that refuses everything makes this
        // pass trivially too. This is the other half, checked separately.
        // An ordinary account's ordinary use of the shell should not surface
        // any 401 or 403 in the first place, because the UI should not be
        // asking for things that role cannot have.
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            const creds = freshAccountCredentials();
            await registerViaUi(page, creds);
            await expect(page.getByTestId("header-command-palette")).toBeVisible({ timeout: 30000 });

            const meRes = await page.request.get("/api/v1/multiuser/me");
            const meBody = await meRes.json();
            expect(meBody.account?.role).toBe("user");

            const collected = collectResponses(page);
            await page.goto("/#/messages");
            await page.waitForTimeout(1500);
            await page.goto("/#/settings");
            await page.waitForTimeout(1500);

            const refused = collected.responses.filter((r) => r.status === 401 || r.status === 403);
            expect(refused, JSON.stringify(refused)).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
