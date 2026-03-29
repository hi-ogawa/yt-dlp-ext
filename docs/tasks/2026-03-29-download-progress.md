# Download Progress

## Goal

Show per-chunk download progress in the UI while audio is being fetched in the content script.

## Current state

- `downloadBytes` in `content.ts` is the shared helper for all chunked range fetching
- It is called by `downloadFormat` (full file), `downloadHeader` (512 KB header), and `downloadRange` (fast-seek cluster data)
- The fast-seek path (`downloadFastSeek` in `lib/fast-seek.ts`) calls `downloadHeader` then `downloadRange`; the full-download path calls `downloadFormat`
- The download button shows "Downloading..." with no indication of how much has been fetched

## Design

Server-to-client callbacks are a first-class citizen of the RPC mechanism. Every `RpcClient` method accepts an optional `opts` second argument typed to the callbacks that method can emit. Callers use `rpc.method(params)` or `rpc.method(params, { onCallback })`. One uniform API surface, no per-feature escape hatches.

### `lib/rpc.ts`

Generic callback envelope and options, plus a second type param on `RpcClient` for the callbacks map:

```ts
export interface RpcCallback<T = unknown> {
  type: "ytdl-callback";
  id: string;
  payload: T;
}

export interface RpcCallOptions<TCallback = never> {
  onCallback?: (cb: TCallback) => void;
}

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
  Callbacks extends { [M in keyof Handlers]?: unknown },
>(
  call: (
    method: string,
    params: unknown,
    opts?: RpcCallOptions<unknown>,
  ) => Promise<unknown>,
): RpcClient<Handlers, Callbacks>;
```

Methods with no entry in `Callbacks` get `opts?: RpcCallOptions<never>`, making `onCallback` typed as `(cb: never) => void` — effectively absent.

### `content.ts` — server side

`downloadBytes` gets an optional `onProgress` callback:

```ts
async function downloadBytes(
  url: string,
  start: number,
  end: number,
  onProgress?: (bytesReceived: number, totalBytes: number) => void,
): Promise<Uint8Array>;
```

Handlers receive a generic `HandlerCtx<TCallback>` second argument:

```ts
type HandlerCtx<TCallback = never> = {
  sendCallback: (payload: TCallback) => void;
};
```

`downloadFormat` and `downloadRange` are typed with `HandlerCtx<ProgressCallback>` and pass `() => ctx.sendCallback({ kind: "progress", bytesReceived, totalBytes })` to `downloadBytes`. `getStreamingFormats`, `downloadHeader`, and `fetchThumbnail` ignore ctx.

The message loop creates `sendCallback` per request and posts `ytdl-callback` messages:

```ts
const sendCallback = (payload: unknown) => {
  window.parent.postMessage(
    { type: "ytdl-callback", id, payload } satisfies RpcCallback,
    "*",
  );
};
const result = await handler(params as never, { sendCallback });
```

### `content-rpc.ts` — client side

Declare the callbacks map and export `ContentRpc`. `initContentRpc` returns `ContentRpc` directly:

```ts
type ProgressCallback = { kind: "progress"; bytesReceived: number; totalBytes: number };

type ContentRpcCallbacks = {
  downloadFormat: ProgressCallback;
  downloadRange: ProgressCallback;
};

export type ContentRpc = RpcClient<typeof contentRpcHandlers, ContentRpcCallbacks>;

export const initContentRpc = once(
  () => new Promise<ContentRpc>((resolve, reject) => { ... })
);
```

`createIframeRpc` uses a single `call(method, params, opts?)` that forwards `ytdl-callback` payloads to `opts?.onCallback`, cleaned up on `ytdl-response`:

```ts
function call(
  method: string,
  params: unknown,
  opts?: RpcCallOptions<unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const ac = new AbortController();

    window.addEventListener(
      "message",
      (e: MessageEvent) => {
        const msg = e.data as RpcResponse | RpcCallback;
        if (!msg || msg.id !== id) return;
        if (msg.type === "ytdl-callback") {
          opts?.onCallback?.(msg.payload);
          return;
        }
        if (msg.type === "ytdl-response") {
          ac.abort();
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      },
      { signal: ac.signal },
    );

    iframe.contentWindow!.postMessage(
      { type: "ytdl-request", id, method, params } satisfies RpcRequest,
      "https://www.youtube.com",
    );
  });
}

return createRpcProxy<typeof contentRpcHandlers, ContentRpcCallbacks>(call);
```

### `lib/fast-seek.ts`

`downloadFastSeek` accepts an optional `onCallback` typed to `ProgressCallback` and passes it to `rpc.downloadRange`:

```ts
export async function downloadFastSeek(opts: {
  rpc: ContentRpc;
  workerRpc: WorkerRpc;
  videoId: string;
  itag: number;
  startTime: number;
  endTime: number;
  onCallback?: (cb: ProgressCallback) => void;
}): Promise<ArrayBuffer>;
```

Step 4 (cluster download):

```ts
const clusterData = await rpc.downloadRange(
  { format: headerResult.format, start: range.start, end: range.end },
  { onCallback },
);
```

`downloadHeader` (512 KB) is called without `onCallback` — negligible size.

### `app.tsx` — UI

- `initContentRpc` returns `ContentRpc`; `DownloadForm` takes `contentRpc: ContentRpc`
- Full download: `rpc.downloadFormat({ videoId, itag }, { onCallback })`
- Fast-seek: `downloadFastSeek({ rpc, workerRpc, ..., onCallback })`
- `onCallback` handler checks `cb.kind === "progress"` and updates `downloadProgress` state
- `downloadPhase: "downloading" | "processing" | undefined` state tracks the active step
- `downloadProgress: { bytesReceived: number; totalBytes: number } | undefined` state
- Both reset to `undefined` in `onSettled`
- **Two-phase button label:**
  - `"downloading"`: `"Downloading... (51%)"` — percentage from `downloadProgress`
  - `"processing"`: `"Processing..."` — no granular progress (WASM is atomic)
  - Done: `"Done"`

## Steps

1. `lib/rpc.ts`: add `RpcCallback<T>`, `RpcCallOptions<TCallback>`; update `RpcClient` with `Callbacks` second type param; update `createRpcProxy` to pass `opts` through
2. `content.ts`: add `onProgress` to `downloadBytes`; change `HandlerCtx` to generic `HandlerCtx<TCallback>` with `sendCallback`; thread through `downloadFormat` and `downloadRange`; post `ytdl-callback` from message loop
3. `content-rpc.ts`: declare `ProgressCallback` and `ContentRpcCallbacks`; `initContentRpc` returns `ContentRpc`; single `call` handles `ytdl-callback` dispatch
4. `lib/fast-seek.ts`: add `onCallback` to opts; pass to `rpc.downloadRange`
5. `app.tsx`: use `ContentRpc` directly; add `downloadPhase` + `downloadProgress` state; wire `onCallback` through both download paths; render two-phase button label
6. `pnpm build && pnpm build-ext` to verify, then `pnpm lint`

## Non-goals

- Callbacks during `convertWebmToOpus` (worker step) — out of scope
- Progress during `downloadHeader` (512 KB, negligible) — not worth tracking
- Progress during `fetchThumbnail` — tiny, not worth it
