import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  expect: {
    timeout: 2000,
  },
  use: {
    actionTimeout: 2000,
  },
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/report.json" }],
    ...(process.env.CI ? [["github"] as const] : []),
  ],
  projects: [
    {
      name: "ext",
      testDir: "./e2e",
    },
  ],
});
