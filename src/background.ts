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
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { data: btoa(binary), finalUrl: response.url };
  },
};

registerRuntimeHandlers(backgroundRpcHandlers);
