import { expect } from "@playwright/test";
import { setupPageLogging, test, TEST_VIDEO_ID } from "./helper.ts";

test("extension page renders with search form", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator("text=yt-dlp-ext")).toBeVisible();
  await expect(page.getByText("Video ID")).toBeVisible();
  await expect(page.getByPlaceholder("ID or URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
});

test("invalid video ID shows error toast", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByPlaceholder("ID or URL").fill("invalid");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Invalid video ID or URL")).toBeVisible();
});

test("search video and download audio @yt", async ({ page, extensionId }) => {
  setupPageLogging(page);

  await page.goto(`chrome-extension://${extensionId}/index.html`);

  // Search for video
  await page.getByPlaceholder("ID or URL").fill(TEST_VIDEO_ID);
  await page.getByRole("button", { name: "Search" }).click();

  // Should show video info and audio format selector
  await expect(page.locator("select")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("img[src*=ytimg]")).toBeVisible();

  // Verify audio formats are listed (at least one option)
  const options = page.locator("select option");
  await expect(options.first()).toBeAttached();
  const firstOption = await options.first().textContent();
  expect(firstOption).toContain("audio/");

  // Download + convert to OPUS
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".opus");

  // Success toast
  await expect(page.getByText("Downloaded")).toBeVisible({ timeout: 60_000 });
});

// TODO
test.skip("search video and download trimmed audio @yt", async ({
  page,
  extensionId,
}) => {
  setupPageLogging(page);

  await page.goto(`chrome-extension://${extensionId}/index.html`);

  // Search for video
  await page.getByPlaceholder("ID or URL").fill(TEST_VIDEO_ID);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("select")).toBeVisible({ timeout: 15_000 });

  // Fill trim fields — first 10 seconds
  const inputs = page.locator('input[placeholder="0:00"]');
  await inputs.first().fill("0:00");
  await inputs.last().fill("0:10");

  // Download (fast-seek path)
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".opus");

  // Success toast
  await expect(page.getByText("Downloaded")).toBeVisible({ timeout: 60_000 });
});
