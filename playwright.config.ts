import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (`npm run build` first), served by `astro preview`
 * under the same /mule-learning-web/ base path as GitHub Pages.
 * Google Chrome is used (no browser download; Playwright's own Chromium can't play MP4/H.264).
 * PW_CHANNEL=chromium switches to Playwright's Chromium (`npx playwright install chromium`).
 * BASE_URL=https://developerashok99.github.io/mule-learning-web/ runs the same tests against the live site.
 */
const port = 4322;
const external = process.env.BASE_URL;
const channel = process.env.PW_CHANNEL ?? "chrome";
const use = channel === "chromium" ? {} : { channel };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: external ?? `http://localhost:${port}/mule-learning-web/`,
    trace: "retain-on-failure",
    // let media start without a user gesture in tests
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...use, viewport: { width: 1366, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], ...use } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], ...use, viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false } },
  ],
  webServer: external
    ? undefined
    : { command: `npx astro preview --port ${port} --ignore-lock`, url: `http://localhost:${port}/mule-learning-web/`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
