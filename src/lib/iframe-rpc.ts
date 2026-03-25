// postMessage RPC client for communicating with the content script
// inside a YouTube embed iframe.

interface RpcRequest {
  type: "ytdl-request";
  id: string;
  method: string;
  params: unknown;
}

interface RpcResponse {
  type: "ytdl-response";
  id: string;
  result?: unknown;
  error?: string;
}

const IFRAME_ID = "yt-embed";

export type IframeRpc = ReturnType<typeof createIframeRpc>;

/** Wait for the content script to signal readiness, then create the RPC client. */
export function initIframeRpc(): Promise<IframeRpc> {
  return new Promise((resolve) => {
    const ac = new AbortController();
    window.addEventListener(
      "message",
      (e: MessageEvent) => {
        if (e.data?.type === "ytdl-ready") {
          ac.abort();
          resolve(createIframeRpc());
        }
      },
      { signal: ac.signal },
    );
  });
}

function createIframeRpc() {
  const iframe = document.getElementById(IFRAME_ID) as HTMLIFrameElement;

  function call(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const ac = new AbortController();

      window.addEventListener(
        "message",
        (e: MessageEvent) => {
          const msg = e.data as RpcResponse;
          if (msg?.type !== "ytdl-response" || msg.id !== id) return;
          ac.abort();
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        },
        { signal: ac.signal },
      );

      const request: RpcRequest = {
        type: "ytdl-request",
        id,
        method,
        params,
      };
      iframe.contentWindow!.postMessage(request, "https://www.youtube.com");
    });
  }

  return {
    getStreamingFormats: (params: { videoId: string }) =>
      call("getStreamingFormats", params),
    downloadFormat: (params: { videoId: string; itag: number }) =>
      call("downloadFormat", params),
    fetchThumbnail: (params: { videoId: string }) =>
      call("fetchThumbnail", params),
  };
}
