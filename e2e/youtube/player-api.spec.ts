import { expect, test } from "@playwright/test";
import { fetchPlayerApi } from "../../src/lib/youtube.ts";

const TEST_VIDEO_ID = "bX1xq3cOFuA";

test("fetchPlayerApi: metadata + streaming formats", async ({ page }) => {
  await page.goto(`https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`);

  const result = await page.evaluate(fetchPlayerApi, TEST_VIDEO_ID);

  expect(result.video.youtubeId).toBe(TEST_VIDEO_ID);
  expect(result.video.title).toBeTruthy();
  expect(result.video.channelName).toBeTruthy();
  expect(result.video.duration).toBeGreaterThan(0);

  // Should have streaming formats
  expect(result.streamingFormats.length).toBeGreaterThan(0);

  // Should have at least one audio-only format
  const audioFormats = result.streamingFormats.filter((f) =>
    f.mimeType.startsWith("audio/"),
  );
  expect(audioFormats.length).toBeGreaterThan(0);

  // Audio formats should have contentLength
  const withSize = audioFormats.filter((f) => f.contentLength);
  expect(withSize.length).toBeGreaterThan(0);

  // Format fields should be populated
  const format = withSize[0];
  expect(format.url).toMatch(/^https:\/\//);
  expect(format.itag).toBeGreaterThan(0);
  expect(format.mimeType).toContain("audio/");
  expect(format.contentLength).toBeGreaterThan(0);
});
