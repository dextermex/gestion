import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end suite: the built app, started as in production, driven in
 * a real browser against a real Supabase (the local stack `supabase start`
 * brings up in CI, see docs/QUALITY.md). Nothing is mocked: sign-ups go
 * through GoTrue, rows through PostgREST and the same policies as the hosted
 * project. One worker, because the flows write to one database and read
 * each other's outcome in order.
 */
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : [["list"]],
  outputDir: "../test-results",
  use: {
    baseURL,
    locale: "fr-LU",
    // A control that never becomes clickable, or a page that never loads,
    // fails here with its name rather than at the end of the test's budget.
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // A sandbox with a preinstalled Chromium points at it here; CI installs its own.
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } : {}),
      },
    },
    // A phone-sized WebKit, the closest a Linux runner comes to iPhone
    // Safari: the auth door, the typing checks and Messages as a phone shows
    // them, where the phone matters.
    ...(process.env.E2E_WEBKIT === "1"
      ? [{ name: "iphone-webkit", use: { ...devices["iPhone 14"] }, testMatch: /(auth|focus|messages-phone)\.spec\.ts/ }]
      : []),
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${baseURL}/connexion`,
    cwd: "..",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
