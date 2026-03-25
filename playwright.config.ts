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
    timeout: 5000,
  },
  retries: process.env.CI ? 1 : 0,
  use: {
    trace: "on-all-retries",
    actionTimeout: 5000,
    navigationTimeout: 5000,
    ...devices["Desktop Chrome"],
  },
});
