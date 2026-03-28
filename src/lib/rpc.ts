// Typed postMessage RPC shared between extension page (client) and content script (server).

export interface RpcRequest {
  type: "ytdl-request";
  id: string;
  method: string;
  params: unknown;
}

export interface RpcResponse {
  type: "ytdl-response";
  id: string;
  result?: unknown;
  error?: string;
}

export interface RpcProgress {
  type: "ytdl-progress";
  id: string;
  bytesReceived: number;
  totalBytes: number;
}

// --- Typed proxy ---

type HandlerParams<H> = H extends (params: infer P) => Promise<unknown>
  ? P
  : never;

type HandlerResult<H> = H extends (...args: never[]) => Promise<infer R>
  ? R
  : never;

export type RpcClient<Handlers> = {
  [M in keyof Handlers]: (
    params: HandlerParams<Handlers[M]>,
  ) => Promise<HandlerResult<Handlers[M]>>;
};

export function createRpcProxy<Handlers>(
  call: (method: string, params: unknown) => Promise<unknown>,
): RpcClient<Handlers> {
  return new Proxy({} as RpcClient<Handlers>, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then" || prop === "toJSON")
        return undefined;
      return (params: unknown) => call(prop, params);
    },
  });
}

export function once<T>(fn: () => T): () => T {
  let result: { value: T } | undefined;
  return () => {
    if (!result) result = { value: fn() };
    return result.value;
  };
}
