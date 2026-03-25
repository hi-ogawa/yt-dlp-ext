// postMessage RPC client for communicating with the content script
// inside a YouTube embed iframe.

import type { contentRpcHandlers } from "./content.ts";
import type { RpcClient, RpcRequest, RpcResponse } from "./lib/rpc.ts";
import { createRpcProxy } from "./lib/rpc.ts";

export type ContentRpc = RpcClient<typeof contentRpcHandlers>;

let contentRpcPromise: Promise<ContentRpc> | undefined;

export function initContentRpc(): Promise<ContentRpc> {
  if (!contentRpcPromise) {
    contentRpcPromise = new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube.com/embed/";
      iframe.style.display = "none";

      iframe.addEventListener("error", (e) => {
        reject(new Error(`Iframe error: ${e.message}`));
      });

      window.addEventListener(
        "message",
        (e: MessageEvent) => {
          if (e.data?.type === "ytdl-ready") {
            resolve(createIframeRpc(iframe));
          }
        },
        { once: true },
      );

      document.body.appendChild(iframe);
    });
  }
  return contentRpcPromise;
}

function createIframeRpc(iframe: HTMLIFrameElement): ContentRpc {
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
