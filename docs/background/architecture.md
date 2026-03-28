# Architecture

## Overview

yt-dlp-ext is a web app + Chrome extension for downloading YouTube audio.

- **Web app** (`https://yt-dlp-ext.hiro18181.workers.dev/`) — React UI served as a static site on Cloudflare Workers. Handles search, format selection, metadata editing, trimming, and audio conversion (mediabunny WASM).
- **Extension** — invisible backend. Injects a content script into YouTube iframes so the web app can make same-origin YouTube API calls and fetch audio via chunked range requests.

The web app lives on a real HTTP origin, so YouTube player embeds and all browser APIs work without restriction. The extension's only job is providing YouTube access.

## Components

### Web app (`src/index.tsx`)

React app hosted on Cloudflare Workers. Orchestrates all flows. Calls content script RPCs for network access and worker RPCs for audio processing.

### Content script (`src/content.ts`)

Injected into a hidden `<iframe src="https://www.youtube.com/embed/">` created by the web app. Runs in MAIN world with `all_frames: true`. Has same-origin access to YouTube — can call `youtubei/v1/player` and fetch from YouTube's CDN via Range requests.

RPC methods:

| Method                | What it does                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| `getStreamingFormats` | Calls YouTube player API, returns video metadata + format list                  |
| `downloadFormat`      | Downloads entire file via chunked 5MB Range requests                            |
| `downloadHeader`      | Downloads first N bytes (for WebM header/cue parsing); returns format for reuse |
| `downloadRange`       | Downloads a specific byte range (for fast-seek clusters)                        |
| `fetchThumbnail`      | Fetches thumbnail JPEG from `i.ytimg.com`                                       |

### Worker (`src/worker.ts`)

Handles CPU-intensive operations off the main thread.

RPC methods:

| Method              | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `convertWebmToOpus` | mediabunny: WebM → Opus with metadata (title/artist/album/cover art) |
| `parseWebmHeader`   | libwebm WASM: parse EBML header, extract cue points                  |
| `remuxWebm`         | libwebm WASM: combine metadata + partial clusters → valid WebM       |

### Background (`src/background.ts`)

Opens the hosted web app URL when the extension action is clicked.

### RPC framework (`src/lib/rpc.ts`, `src/content-rpc.ts`, `src/worker-rpc.ts`)

Both boundaries use the same protocol: `{ type: "ytdl-request", id, method, params }` / `{ type: "ytdl-response", id, result?, error? }`. `createRpcProxy()` returns a typed proxy that maps method calls to postMessage round-trips.

ArrayBuffers are transferred (zero-copy), not cloned. The worker RPC auto-detects ArrayBuffer values in params via `findTransferables()`. The content script RPC transfers `result.data` if it's an ArrayBuffer.

Both sides signal readiness with `{ type: "ytdl-ready" }` on init.

## Data flows

### Full download (no trim)

```
Web app                       Content script              Worker
 │                                 │                         │
 │ getStreamingFormats(videoId)    │                         │
 │───────────────────────────────►│                         │
 │◄── PlayerApiResult ────────────┤                         │
 │                                 │                         │
 │ downloadFormat(videoId, itag)   │                         │
 │───────────────────────────────►│                         │
 │              chunked Range fetch from YouTube CDN         │
 │◄── ArrayBuffer (full WebM) ────┤                         │
 │                                 │                         │
 │ fetchThumbnail(videoId)         │                         │
 │───────────────────────────────►│                         │
 │◄── ArrayBuffer (JPEG) ─────────┤                         │
 │                                                           │
 │ convertWebmToOpus(webmData, metadata)                     │
 │──────────────────────────────────────────────────────────►│
 │                                          mediabunny WebM→Opus
 │◄── ArrayBuffer (Opus) ───────────────────────────────────┤
 │                                                           │
 │ blob → <a>.click() → Downloads/
```

### Fast-seek download (with trim)

```
Web app                       Content script              Worker
 │                                 │                         │
 │ downloadHeader(512KB)           │                         │
 │───────────────────────────────►│                         │
 │              Range: bytes=0-524287                         │
 │◄── { data, format } ───────────┤                         │
 │                                                           │
 │ parseWebmHeader(headerData)                               │
 │──────────────────────────────────────────────────────────►│
 │                                          libwebm WASM parse
 │◄── SimpleMetadata (cue points) ──────────────────────────┤
 │                                                           │
 │ findContainingRange(metadata, startTime, endTime)         │
 │ → { start, end } byte offsets (local computation)         │
 │                                                           │
 │ downloadRange(format, start, end)                         │
 │───────────────────────────────►│                         │
 │              Range: bytes=start-end                        │
 │◄── ArrayBuffer (clusters) ─────┤                         │
 │                                                           │
 │ remuxWebm(headerData, clusterData)                        │
 │──────────────────────────────────────────────────────────►│
 │                                          libwebm WASM remux
 │◄── ArrayBuffer (valid WebM) ─────────────────────────────┤
 │                                                           │
 │ convertWebmToOpus(remuxedWebm, metadata, trim)            │
 │──────────────────────────────────────────────────────────►│
 │                                          mediabunny WebM→Opus
 │◄── ArrayBuffer (Opus) ───────────────────────────────────┤
 │                                                           │
 │ blob → <a>.click() → Downloads/
```

For a 1-hour file trimmed to 30 seconds: downloads ~512KB header + ~1% of clusters instead of the full file. `format` returned by `downloadHeader` is reused by `downloadRange` — no second `fetchPlayerApi` call.

## Iframe trick

The web app creates a hidden `<iframe src="https://www.youtube.com/embed/">`. The content script (`MAIN` world, `all_frames: true`, `document_start`) injects into this iframe and gets same-origin access to YouTube — it can call `youtubei/v1/player` and fetch from YouTube's CDN.

The `/embed/` endpoint is used because it allows framing (no `X-Frame-Options` block). This makes the extension self-contained — no YouTube tab needed.

## POT bypass

YouTube's WEB client requires POT (Proof of Origin Token, generated by botguard JS). Mobile clients (ANDROID_VR) don't — mobile apps have their own attestation, so YouTube doesn't layer botguard on top.

The content script calls `youtubei/v1/player` with ANDROID_VR client headers. `visitorData` is extracted from `ytcfg` on the embed page. This is fragile — YouTube can break it by requiring POT for mobile clients.

## Extension detection

The web app waits for a `ytdl-ready` postMessage from the content script. With `document_start` injection, this arrives in under 500ms when the extension is installed. After ~2s with no signal, the web app shows a soft CTA to install the extension.
