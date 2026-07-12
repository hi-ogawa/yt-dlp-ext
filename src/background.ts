import { toBase64 } from "./lib/base64.ts";
import { registerRuntimeHandlers } from "./lib/extension-rpc.ts";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://yt-dlp-ext.hiro18181.workers.dev/" });
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
