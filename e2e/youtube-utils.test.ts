import { expect, test } from "@playwright/test";
import { parseVideoId } from "../src/lib/youtube-utils.ts";
import { TEST_VIDEO_ID } from "./helper.ts";

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
