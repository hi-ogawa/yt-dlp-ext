import net from "node:net";
import { defineConfig, devices } from "@playwright/test";

function getFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, () => {
        const port = (fallback.address() as net.AddressInfo).port;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferred, () => {
      server.close(() => resolve(preferred));
    });
  });
}

const port = process.env.E2E_PORT
  ? Number(process.env.E2E_PORT)
  : await getFreePort(5190);
process.env.E2E_PORT = String(port);

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
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-all-retries",
    actionTimeout: 5000,
    navigationTimeout: 5000,
    ...devices["Desktop Chrome"],
  },
});
