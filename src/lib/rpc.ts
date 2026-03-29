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

export interface RpcCallback<T = unknown> {
  type: "ytdl-callback";
  id: string;
  payload: T;
}

export interface RpcCallOptions<TCallback = never> {
  onCallback?: (cb: TCallback) => void;
}

// --- Typed proxy ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerParams<H> = H extends (
  params: infer P,
  ...args: any[]
) => Promise<unknown>
  ? P
  : never;

type HandlerResult<H> = H extends (...args: never[]) => Promise<infer R>
  ? R
  : never;

export type RpcClient<
  Handlers,
  Callbacks extends { [M in keyof Handlers]?: unknown } = {
    [M in keyof Handlers]?: never;
  },
> = {
  [M in keyof Handlers]: (
    params: HandlerParams<Handlers[M]>,
    opts?: RpcCallOptions<Callbacks[M]>,
  ) => Promise<HandlerResult<Handlers[M]>>;
};

export function createRpcProxy<
  Handlers,
  Callbacks extends { [M in keyof Handlers]?: unknown } = {
    [M in keyof Handlers]?: never;
  },
>(
  call: (
    method: string,
    params: unknown,
    opts?: RpcCallOptions<unknown>,
  ) => Promise<unknown>,
): RpcClient<Handlers, Callbacks> {
  return new Proxy({} as RpcClient<Handlers, Callbacks>, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then" || prop === "toJSON")
        return undefined;
      return (params: unknown, opts?: RpcCallOptions<unknown>) =>
        call(prop, params, opts);
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
