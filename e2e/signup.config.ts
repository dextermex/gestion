import { defineConfig } from "@playwright/test";

// API integration checks against the real throwaway Auth, PostgREST and app
// servers. SMS uses Supabase's local test-OTP fixture; mail stays in Mailpit.
export default defineConfig({
  testDir: "./signup",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4321" },
  webServer: {
    command: "npx next start -H 127.0.0.1 -p 4321",
    url: "http://127.0.0.1:4321/inscription",
    cwd: "..",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
