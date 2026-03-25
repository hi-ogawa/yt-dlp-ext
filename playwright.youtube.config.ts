import { defineConfig, devices } from "@playwright/test";

// Separate config for YouTube API tests.
// No extension, no web server — runs against real YouTube pages.
export default defineConfig({
  testDir: "./e2e/youtube",
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    ...devices["Desktop Chrome"],
  },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
});
