# Architecture

## Overview

yt-dlp-ext is a web app + Chrome extension for downloading YouTube audio.

- **Web app** (`https://yt-dlp-ext.hiro18181.workers.dev/`) — React UI served as a static site on Cloudflare Workers. Handles search, format selection, metadata editing, trimming, and audio conversion (mediabunny WASM).
- **Extension** — invisible backend. Injects a content script into YouTube iframes so the web app can make same-origin YouTube API calls and fetch audio via chunked range requests.

The web app lives on a real HTTP origin, so YouTube player embeds and all browser APIs work without restriction. The extension's only job is providing YouTube access.

## Problem: POT

Server-side YouTube audio downloaders broke when YouTube added POT (Proof of Origin Token). POT is generated at runtime by botguard JS — no external server can produce it.

A content script on `youtube.com` has same-origin access, but a typical extension would require the user to have a YouTube tab open.

## Iframe trick

The web app creates a hidden `<iframe src="https://www.youtube.com/embed/">`. The content script (`MAIN` world, `all_frames: true`, `document_start`) injects into this iframe and gets same-origin access to YouTube — it can call `youtubei/v1/player` and fetch from YouTube's CDN.

The `/embed/` endpoint is used because it allows framing (no `X-Frame-Options` block). This makes the extension self-contained — no YouTube tab needed.

## POT bypass

YouTube's WEB client requires POT. Mobile clients (ANDROID_VR) don't — mobile apps have their own attestation, so YouTube doesn't layer botguard on top.

The content script calls `youtubei/v1/player` with ANDROID_VR client headers. `visitorData` is extracted from `ytcfg` on the embed page. This is fragile — YouTube can break it by requiring POT for mobile clients.

## Data flow

```
Web app (https://yt-dlp-ext.hiro18181.workers.dev/)
  │
  ├── creates hidden <iframe src="youtube.com/embed/">
  │     └── content script injected (MAIN world, same-origin)
  │           ├── fetchPlayerApi() — ANDROID_VR headers, no POT
  │           └── downloadFormat() — chunked range fetch
  │
  ├── postMessage RPC
  │     request:  { type: "ytdl-request", method, params }
  │     response: { type: "ytdl-response", result/error }
  │
  └── Web Worker (mediabunny)
        └── convertWebmToOpus() — remux + metadata + trim
```

## Extension detection

The web app waits for a `ytdl-ready` postMessage from the content script. With `document_start` injection, this arrives in under 500ms when the extension is installed. After ~2s with no signal, the web app shows a soft CTA to install the extension.
