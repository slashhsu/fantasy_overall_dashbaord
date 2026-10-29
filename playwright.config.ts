import { defineConfig, devices } from "@playwright/test";

const localBrowser = process.platform === "darwin" ? { channel: "chrome" as const } : {};

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...localBrowser } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], ...localBrowser } },
  ],
  webServer: {
    command: "APP_PASSWORD=local-preview-password MEMBER_PASSWORD=local-preview-member-password MEMBER_ALLOWED_LEAGUE_KEYS=demo.l.101 SESSION_SECRET=local-preview-signing-secret-at-least-32-characters YAHOO_DEMO_MODE=true pnpm exec next dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
