import { expect } from "@playwright/test";
import { parseVideoId } from "../src/lib/youtube-utils.ts";
import { setupPageLogging, test, TEST_VIDEO_ID } from "./helper.ts";

test("renders with search form", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("text=yt-dlp-ext")).toBeVisible();
  await expect(page.getByText("Video ID")).toBeVisible();
  await expect(page.getByPlaceholder("ID or URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
});

test("prefills video ID from query parameter", async ({ page }) => {
  await page.goto(`/?v=${TEST_VIDEO_ID}`);
  await expect(page.getByPlaceholder("ID or URL")).toHaveValue(TEST_VIDEO_ID);
});

test("parses supported YouTube video URLs", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}&list=playlist`,
    `https://www.youtube.com/shorts/${TEST_VIDEO_ID}`,
    `https://www.youtube.com/live/${TEST_VIDEO_ID}?feature=share`,
    `https://www.youtube.com/embed/${TEST_VIDEO_ID}`,
    `https://music.youtube.com/watch?v=${TEST_VIDEO_ID}`,
    `https://youtu.be/${TEST_VIDEO_ID}?t=10`,
  ]) {
    expect(parseVideoId(url)).toBe(TEST_VIDEO_ID);
  }
  expect(parseVideoId("https://www.youtube.com/")).toBeUndefined();
  expect(
    parseVideoId("https://example.com/watch?v=bX1xq3cOFuA"),
  ).toBeUndefined();
});

test("invalid video ID shows error toast", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("ID or URL").fill("invalid");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Invalid video ID or URL")).toBeVisible();
});

test("search video and download audio @yt", async ({ page }) => {
  setupPageLogging(page);

  await page.goto("/");

  // Search for video
  await page.getByPlaceholder("ID or URL").fill(TEST_VIDEO_ID);
  await page.getByRole("button", { name: "Search" }).click();

  // Should show video info and audio format selector
  await expect(page.locator("select")).toBeVisible({ timeout: 15_000 });

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

test("search video and download trimmed audio @yt", async ({ page }) => {
  setupPageLogging(page);

  await page.goto("/");

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
