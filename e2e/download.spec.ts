import { expect } from "@playwright/test";
import { test } from "./helper.ts";

const VIDEO_ID = "bX1xq3cOFuA";

test("search video and download audio", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  // Wait for iframe content script to be ready
  await expect(page.getByText("Connecting to YouTube...")).not.toBeVisible({
    timeout: 15_000,
  });

  // Search for video
  await page.getByPlaceholder("ID or URL").fill(VIDEO_ID);
  await page.getByRole("button", { name: "Search" }).click();

  // Should show video info and audio format selector
  await expect(page.locator("select")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("img[src*=ytimg]")).toBeVisible();

  // Verify audio formats are listed (at least one option)
  const options = page.locator("select option");
  await expect(options.first()).toBeAttached();
  const firstOption = await options.first().textContent();
  expect(firstOption).toContain("audio/");

  // Download
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".webm");

  // Success toast
  await expect(page.getByText("Downloaded")).toBeVisible({ timeout: 60_000 });
});
