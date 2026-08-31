const { defineConfig, devices } = require("@playwright/test");

// Config for the opt-in, read-only smoke check against the REAL hosted
// instance (tests/e2e/live). No webServer: there is nothing to boot, the
// target is a live deployment. The spec itself refuses to run any assertion
// unless E2E_LIVE_SMOKE=1 is also set, so pointing this config at CI by
// habit is not enough on its own to make it touch the live site.
//
// Run with:
//   E2E_LIVE_SMOKE=1 pnpm exec playwright test --config=playwright.live.config.js

const baseURL = process.env.E2E_LIVE_BASE_URL || "https://msg.quasarke.net";

module.exports = defineConfig({
    testDir: "./tests/e2e/live",
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: process.env.CI ? "line" : [["list"]],
    use: {
        ...devices["Desktop Chrome"],
        baseURL,
        trace: "off",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "live-chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
