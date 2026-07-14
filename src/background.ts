import { parseVideoId } from "./lib/youtube-utils.ts";

const APP_URL = "https://yt-dlp-ext.hiro18181.workers.dev/";

chrome.action.onClicked.addListener((tab) => {
  const url = new URL(APP_URL);
  const videoId = parseVideoId(tab.url ?? "");
  if (videoId) {
    url.searchParams.set("v", videoId);
  }
  chrome.tabs.create({ url: url.href });
});
