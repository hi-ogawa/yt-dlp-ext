import path from "node:path";
import {
  test as baseTest,
  chromium,
  type BrowserContext,
} from "@playwright/test";

export const test = baseTest.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const extensionPath = path.resolve("dist/ext");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--window-size=1380,900`,
      ],
      viewport: {
        width: 1280,
        height: 800,
      },
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }
    await use(serviceWorker.url().split("/")[2]);
  },
});
