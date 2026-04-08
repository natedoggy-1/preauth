import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for PreAuth AI visual E2E tests.
 *
 * The Expo web app should be running before tests execute:
 *   cd hyve-chat && npx expo start --web
 *
 * Override the base URL via the APP_URL env var:
 *   APP_URL=http://localhost:19006 npx playwright test
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,          // run sequentially — tests depend on app state
  retries: 0,
  timeout: 120_000,              // 2 min per test (letter generation can be slow)
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: process.env.APP_URL || "http://localhost:8081",
    screenshot: "on",             // capture on every test
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
