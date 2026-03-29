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

interface RpcCallbackStub {
  __rpcCallback: string;
}

export interface RpcCallbackInvoke {
  type: "ytdl-callback-invoke";
  requestId: string;
  callbackId: string;
  args: unknown[];
}

// --- Param serialization ---

type AnyFn = (...args: any[]) => void;

export function serializeParams(
  params: unknown,
  register: (id: string, fn: AnyFn) => void,
): unknown {
  if (typeof params === "function") {
    const id = crypto.randomUUID();
    register(id, params as AnyFn);
    return { __rpcCallback: id } satisfies RpcCallbackStub;
  }
  if (Array.isArray(params)) {
    return params.map((v) => serializeParams(v, register));
  }
  if (params !== null && typeof params === "object") {
    return Object.fromEntries(
      Object.entries(params as Record<string, unknown>).map(([k, v]) => [
        k,
        serializeParams(v, register),
      ]),
    );
  }
  return params;
}

export function deserializeParams(
  params: unknown,
  invoke: (callbackId: string, args: unknown[]) => void,
): unknown {
  if (
    params !== null &&
    typeof params === "object" &&
    "__rpcCallback" in params &&
    typeof (params as RpcCallbackStub).__rpcCallback === "string"
  ) {
    const id = (params as RpcCallbackStub).__rpcCallback;
    return (...args: unknown[]) => invoke(id, args);
  }
  if (Array.isArray(params)) {
    return params.map((v) => deserializeParams(v, invoke));
  }
  if (params !== null && typeof params === "object") {
    return Object.fromEntries(
      Object.entries(params as Record<string, unknown>).map(([k, v]) => [
        k,
        deserializeParams(v, invoke),
      ]),
    );
  }
  return params;
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
