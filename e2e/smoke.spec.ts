import { expect } from "@playwright/test";
import { test } from "./helper.ts";

test("extension page renders", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator("text=yt-dlp-ext")).toBeVisible();
  await expect(page.locator("text=Download page placeholder")).toBeVisible();
});
