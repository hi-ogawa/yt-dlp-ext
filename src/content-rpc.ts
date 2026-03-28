// postMessage RPC client for communicating with the content script
// inside a YouTube embed iframe.

import type { contentRpcHandlers } from "./content.ts";
import type {
  RpcClient,
  RpcProgress,
  RpcRequest,
  RpcResponse,
} from "./lib/rpc.ts";
import { createRpcProxy, once } from "./lib/rpc.ts";

export type ContentRpc = RpcClient<typeof contentRpcHandlers>;

export type ContentRpcInit = {
  rpc: ContentRpc;
  callWithProgress: <T>(
    method: string,
    params: unknown,
    onProgress: (bytesReceived: number, totalBytes: number) => void,
  ) => Promise<T>;
};

export const initContentRpc = once(
  () =>
    new Promise<ContentRpcInit>((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube.com/embed/";
      iframe.style.display = "none";

      iframe.addEventListener("error", (e) => {
        reject(new Error(`Iframe error: ${e.message}`));
      });

      const ac = new AbortController();

      window.addEventListener(
        "message",
        (e: MessageEvent) => {
          if (e.data?.type === "ytdl-ready") {
            ac.abort();
            resolve(createIframeRpc(iframe));
          }
        },
        { signal: ac.signal },
      );

      document.body.appendChild(iframe);
    }),
);

function createIframeRpc(iframe: HTMLIFrameElement): ContentRpcInit {
  function call(method: string, params: unknown): Promise<unknown> {
    return callWithProgress(method, params, () => {});
  }

  function callWithProgress<T>(
    method: string,
    params: unknown,
    onProgress: (bytesReceived: number, totalBytes: number) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const ac = new AbortController();

      window.addEventListener(
        "message",
        (e: MessageEvent) => {
          const msg = e.data as RpcResponse | RpcProgress;
          if (!msg || msg.id !== id) return;
          if (msg.type === "ytdl-progress") {
            onProgress(msg.bytesReceived, msg.totalBytes);
            return;
          }
          if (msg.type === "ytdl-response") {
            ac.abort();
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.result as T);
          }
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
    rpc: createRpcProxy<typeof contentRpcHandlers>(call),
    callWithProgress,
  };
}
