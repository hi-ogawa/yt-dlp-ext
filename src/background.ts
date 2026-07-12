chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://yt-dlp-ext.hiro18181.workers.dev/" });
});

chrome.runtime.onMessage.addListener(
  (
    message: { type?: string; url?: string },
    _sender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type !== "ytdl-proxy-fetch" || !message.url) return;
    const url = message.url;

    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Proxy fetch failed: ${response.status}`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        sendResponse({ data: btoa(binary), finalUrl: response.url });
      } catch (error) {
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  },
);
