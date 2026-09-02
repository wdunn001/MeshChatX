const { defineConfig, devices } = require("@playwright/test");

// Separate config for the hosted MULTI-USER entry gate E2E suite
// (tests/e2e/multiuser). Kept apart from playwright.config.js on purpose:
// that config's webServer boots the existing SINGLE-USER dev stack every
// other spec under tests/e2e depends on, and every CI job that already
// exists (scripts/ci/github-e2e.sh) only ever asks it for a narrow slice of
// specs. Adding a second webServer to that config would make Playwright
// start both stacks for every invocation, including the existing narrow
// smoke run, coupling two things that have no reason to depend on each
// other. This config instead boots its own throwaway multi-user instance
// via scripts/e2e/start-e2e-multiuser-stack.sh and nothing else.
//
// Local development: Chromium on this machine can be version-mismatched
// against the Playwright-managed browser. Set E2E_USE_SYSTEM_CHROME=1 to
// drive the installed Chrome via channel: 'chrome' instead.

if (process.env.E2E_MU_BACKEND_PORT === undefined || process.env.E2E_MU_BACKEND_PORT === "") {
    process.env.E2E_MU_BACKEND_PORT = "18081";
}

const HOST = process.env.E2E_MU_VITE_HOST || "127.0.0.1";
const PORT = parseInt(process.env.E2E_MU_VITE_PORT || "5273", 10);
const baseURL = `http://${HOST}:${PORT}`;
const useSystemChrome = process.env.E2E_USE_SYSTEM_CHROME === "1";

module.exports = defineConfig({
    testDir: "./tests/e2e/multiuser",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? "line" : [["list"], ["html", { open: "never" }]],
    use: {
        ...devices["Desktop Chrome"],
        ...(useSystemChrome ? { channel: "chrome" } : {}),
        baseURL,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "multiuser-chromium",
            use: { ...devices["Desktop Chrome"], ...(useSystemChrome ? { channel: "chrome" } : {}) },
        },
    ],
    webServer: {
        command: "bash scripts/e2e/start-e2e-multiuser-stack.sh",
        url: `${baseURL}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 270000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
