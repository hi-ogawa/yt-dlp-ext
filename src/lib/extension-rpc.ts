// Based on https://github.com/hi-ogawa/ytsub-v5/blob/main/src/extension/lib/extension-rpc.ts
import { createRpcProxy, type RpcClient } from "./rpc.ts";

type RuntimeRequest = {
  type: "ytdl-runtime-rpc";
  id: string;
  method: string;
  params: unknown;
};

type RuntimeResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

const RUNTIME_CHANNEL = "ytdl:runtime-rpc";

export function createRuntimeRelayRpc<Handlers>(): RpcClient<Handlers> {
  const channel = new BroadcastChannel(RUNTIME_CHANNEL);
  return createRpcProxy<Handlers>((method, params) => {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const ac = new AbortController();
      channel.addEventListener(
        "message",
        (event: MessageEvent<RuntimeResponse>) => {
          if (event.data.id !== id) return;
          ac.abort();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.result);
        },
        { signal: ac.signal },
      );
      channel.postMessage({ id, method, params });
    });
  });
}

export function setupRuntimeRelay() {
  const channel = new BroadcastChannel(RUNTIME_CHANNEL);
  channel.addEventListener(
    "message",
    async (event: MessageEvent<Omit<RuntimeRequest, "type">>) => {
      const { id, method, params } = event.data;
      try {
        const request: RuntimeRequest = {
          type: "ytdl-runtime-rpc",
          id,
          method,
          params,
        };
        const response = await chrome.runtime.sendMessage(request);
        channel.postMessage({ id, ...response } satisfies RuntimeResponse);
      } catch (error) {
        channel.postMessage({
          id,
          error: error instanceof Error ? error.message : String(error),
        } satisfies RuntimeResponse);
      }
    },
  );
}

export function registerRuntimeHandlers(
  handlers: Record<string, (params: never) => Promise<unknown>>,
) {
  chrome.runtime.onMessage.addListener(
    (message: RuntimeRequest, _sender, sendResponse) => {
      if (message.type !== "ytdl-runtime-rpc") return;
      const handler = handlers[message.method];
      if (!handler) return;
      handler(message.params as never).then(
        (result) => sendResponse({ result }),
        (error: unknown) =>
          sendResponse({
            error: error instanceof Error ? error.message : String(error),
          }),
      );
      return true;
    },
  );
}
