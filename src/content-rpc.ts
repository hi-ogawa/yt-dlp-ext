// postMessage RPC client for communicating with the content script
// inside a YouTube embed iframe.

import type { contentRpcHandlers } from "./content.ts";
import type { RpcClient, RpcRequest, RpcResponse } from "./lib/rpc.ts";
import { createRpcProxy } from "./lib/rpc.ts";

const IFRAME_ID = "yt-embed";

export type ContentRpc = RpcClient<typeof contentRpcHandlers>;

/** Wait for the content script to signal readiness, then create the RPC client. */
export function initContentRpc(): Promise<ContentRpc> {
  return new Promise((resolve) => {
    const ac = new AbortController();
    window.addEventListener(
      "message",
      (e: MessageEvent) => {
        if (e.data?.type === "ytdl-ready") {
          ac.abort();
          resolve(createContentRpc());
        }
      },
      { signal: ac.signal },
    );
  });
}

function createContentRpc(): ContentRpc {
  const iframe = document.getElementById(IFRAME_ID) as HTMLIFrameElement;

  function call(method: string, params: unknown): Promise<unknown> {
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

  return createRpcProxy<typeof contentRpcHandlers>(call);
}
