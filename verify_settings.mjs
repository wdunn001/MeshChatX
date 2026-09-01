// Reproduce the reported symptom against the live instance: sign in as an
// ordinary account, open Settings, and see whether the page stays.
import { chromium } from "playwright";

const BASE = "https://msg.quasarke.net";
const USERNAME = process.argv[2];
const PASSWORD = process.argv[3];

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

const refused = [];
const consoleErrors = [];
page.on("response", (r) => {
    if (r.status() === 401 || r.status() === 403) {
        refused.push(r.status() + " " + new URL(r.url()).pathname);
    }
});
page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140));
});

await page.goto(BASE + "/#/messages", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

await page.fill('input[autocomplete="username"]', USERNAME);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(12000);
console.log("after sign in, url:", page.url());

refused.length = 0;
consoleErrors.length = 0;

await page.goto(BASE + "/#/settings", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
console.log("after opening settings, url:", page.url());

const stayed = page.url().includes("#/settings");
console.log(stayed ? "PASS  settings page stayed" : "FAIL  redirected away from settings");

console.log("refused requests while on settings:", refused.length ? refused.join(", ") : "none");
console.log("console errors:", consoleErrors.length ? consoleErrors.slice(0, 6).join(" | ") : "none");

const tabs = await page.locator(".settings-nav__tab").allTextContents();
console.log("settings tabs offered:", tabs.map((t) => t.split("\n")[0].trim()).join(", "));

// The "more" tray holds the low-traffic entries, so open it before counting.
const moreToggle = page.locator('[data-testid="sidebar-more-toggle"]');
if (await moreToggle.count()) {
    await moreToggle.first().click();
    await page.waitForTimeout(1200);
}
const navLabels = await page.locator('[data-testid="sidebar-nav-item"]').allTextContents();
const nav = [...new Set(navLabels.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))];
console.log("nav entries:", nav.join(" | ").slice(0, 500));
const forbidden = nav.filter((t) => /interface|identit|banish|account/i.test(t));
console.log(forbidden.length ? "FAIL  admin nav entries visible: " + forbidden.join(", ") : "PASS  no admin nav entries");

const signOut = await page.locator('[data-testid="sidebar-sign-out"]').count();
console.log(signOut > 0 ? "PASS  sign out control present" : "FAIL  sign out control missing");

await browser.close();
process.exit(stayed && refused.length === 0 && signOut > 0 && forbidden.length === 0 ? 0 : 1);
