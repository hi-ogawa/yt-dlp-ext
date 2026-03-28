# Download Progress

## Goal

Show per-chunk download progress in the UI while audio is being fetched in the content script.

## Current state

- `downloadBytes` in `content.ts` is the shared helper for all chunked range fetching
- It is called by `downloadFormat` (full file), `downloadHeader` (512 KB header), and `downloadRange` (fast-seek cluster data)
- The fast-seek path (`downloadFastSeek` in `lib/fast-seek.ts`) calls `downloadHeader` then `downloadRange`; the full-download path calls `downloadFormat`
- The download button shows "Downloading..." with no indication of how much has been fetched

## Approach

Thread an optional `sendProgress` callback through `downloadBytes`. Every handler that calls `downloadBytes` receives it via a `HandlerCtx` second argument from the message loop, and passes it along. The web app attaches a progress listener to the one RPC call that matters.

### New message type

Add `RpcProgress` to `lib/rpc.ts`:

```ts
export interface RpcProgress {
  type: "ytdl-progress";
  id: string; // matches the RpcRequest id
  bytesReceived: number;
  totalBytes: number;
}
```

### Content script changes (`content.ts`)

**`downloadBytes` gets an optional callback:**

```ts
async function downloadBytes(
  url: string,
  start: number,
  end: number,
  onProgress?: (bytesReceived: number, totalBytes: number) => void,
): Promise<Uint8Array>;
```

After each chunk's reader loop completes, call:

```ts
onProgress?.(offset, totalSize);
```

**Handler context:**

```ts
type HandlerCtx = {
  sendProgress: (bytesReceived: number, totalBytes: number) => void;
};
```

All handlers receive `(params, ctx: HandlerCtx)`. Those that call `downloadBytes` pass `ctx.sendProgress`; `getStreamingFormats` and `fetchThumbnail` ignore ctx.

**Message loop** creates `sendProgress` per request and passes it:

```ts
const sendProgress = (bytesReceived: number, totalBytes: number) => {
  window.parent.postMessage(
    {
      type: "ytdl-progress",
      id,
      bytesReceived,
      totalBytes,
    } satisfies RpcProgress,
    "*",
  );
};
const result = await handler(params as never, { sendProgress });
```

### RPC client changes (`content-rpc.ts`)

Restructure `initContentRpc` to return `{ rpc, callWithProgress }` where `callWithProgress` is a lower-level helper that registers a `ytdl-progress` listener for the duration of the call:

```ts
export type ContentRpcInit = {
  rpc: ContentRpc;
  callWithProgress: <T>(
    method: string,
    params: unknown,
    onProgress: (bytesReceived: number, totalBytes: number) => void,
  ) => Promise<T>;
};
```

The `ytdl-progress` listener is cleaned up when the matching `ytdl-response` arrives.

### Fast-seek path (`lib/fast-seek.ts`)

`downloadFastSeek` gets an optional `onProgress` param. Pass it to the `downloadRange` call (the bulk of the data). The `downloadHeader` call is 512 KB — negligible, no progress needed there.

```ts
export async function downloadFastSeek(opts: {
  ...
  onProgress?: (bytesReceived: number, totalBytes: number) => void;
}): Promise<ArrayBuffer>
```

Internally, use `callWithProgress("downloadRange", params, opts.onProgress ?? (() => {}))`.

This requires passing `callWithProgress` into `downloadFastSeek` as well:

```ts
export async function downloadFastSeek(opts: {
  rpc: ContentRpc;
  callWithProgress: ContentRpcInit["callWithProgress"];
  workerRpc: WorkerRpc;
  ...
  onProgress?: (bytesReceived: number, totalBytes: number) => void;
})
```

### UI changes (`index.tsx`)

- Destructure `{ rpc, callWithProgress }` from `initContentRpc` result
- Add `downloadPhase: "downloading" | "processing" | undefined` state
- Add `downloadProgress: { bytesReceived: number; totalBytes: number } | undefined` state
- In `downloadMutation.mutationFn`, set phase explicitly:
  - Set `"downloading"` before the download call; update `downloadProgress` via `onProgress`
  - Set `"processing"` before `convertWebmToOpus` (and `remuxWebm` in fast-seek path)
- Reset both to `undefined` in `onSettled`
- **Two-phase button label:**
  - `"downloading"`: `"Downloading... (51%)"` — percentage inline
  - `"processing"`: `"Processing..."` — no granular progress (WASM is atomic)
  - Done: `"Done"`

## Steps

1. Add `RpcProgress` to `lib/rpc.ts`
2. Update `content.ts`: add `HandlerCtx`, add `onProgress` to `downloadBytes`, thread ctx through all handlers
3. Update `content-rpc.ts`: restructure `initContentRpc` to return `{ rpc, callWithProgress }`, implement progress listener
4. Update `lib/fast-seek.ts`: accept `callWithProgress` + `onProgress` in opts; use `callWithProgress` for `downloadRange`
5. Update `index.tsx`: destructure new init shape, add `downloadPhase` + `downloadProgress` state, wire them through both download paths, render two-phase button label
6. `pnpm build && pnpm build-ext` to verify, then `pnpm lint`

## Non-goals

- Progress during `convertWebmToOpus` (worker step) — out of scope
- Progress during `downloadHeader` (512 KB, negligible) — not worth tracking
- Progress during `fetchThumbnail` — tiny, not worth it
