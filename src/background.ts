import { toBase64 } from "./lib/base64.ts";
import { registerRuntimeHandlers } from "./lib/extension-rpc.ts";
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

export const backgroundRpcHandlers = {
  async proxyFetch({ url }: { url: string }) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Proxy fetch failed: ${response.status}`);
    }
    const data = toBase64(new Uint8Array(await response.arrayBuffer()));
    return { data, finalUrl: response.url };
  },
};

registerRuntimeHandlers(backgroundRpcHandlers);
