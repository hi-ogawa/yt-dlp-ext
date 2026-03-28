import path from "node:path";
import {
  test as baseTest,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// https://www.youtube.com/watch?v=bX1xq3cOFuA
export const TEST_VIDEO_ID = "bX1xq3cOFuA";

// Load the built extension in a persistent Chromium context so the
// content script is available on the web app served by the dev server.
export const test = baseTest.extend<{ context: BrowserContext }>({
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
});

/** Surface browser errors on the Playwright CLI console */
export function setupPageLogging(page: Page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[browser:console.error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log(`[browser:pageerror] ${err}`);
  });
  page.on("requestfailed", (req) => {
    console.log(
      `[browser:requestfailed] ${req.url()} ${req.failure()?.errorText}`,
    );
  });
}
