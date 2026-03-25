import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/report.json" }],
    ...(process.env.CI ? [["github"] as const] : []),
  ],
  expect: {
    timeout: 2000,
  },
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: "on-all-retries",
    actionTimeout: 2000,
    navigationTimeout: 2000,
    ...devices["Desktop Chrome"],
  },
});
