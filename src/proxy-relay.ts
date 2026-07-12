type ProxyRequest = {
  type: "ytdl-proxy-request";
  id: string;
  url: string;
};

window.addEventListener("message", (event: MessageEvent<ProxyRequest>) => {
  if (event.source !== window || event.data?.type !== "ytdl-proxy-request") {
    return;
  }

  const { id, url } = event.data;
  chrome.runtime.sendMessage(
    { type: "ytdl-proxy-fetch", url },
    (response: { data?: string; finalUrl?: string; error?: string }) => {
      window.postMessage(
        {
          type: "ytdl-proxy-response",
          id,
          ...response,
          error: chrome.runtime.lastError?.message ?? response?.error,
        },
        "*",
      );
    },
  );
});
