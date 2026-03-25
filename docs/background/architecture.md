# yt-dlp-ext — Architecture

## Problem

Server-side YouTube audio downloaders broke when YouTube added POT (Proof of Origin Token) requirements. POT is generated at runtime by botguard JS in the browser — no external server can produce it. A browser extension can bypass this entirely by running on YouTube's origin.

## Why an extension with an iframe

A content script on `youtube.com` has same-origin access to YouTube's internal APIs. But a typical extension architecture would require the user to have a YouTube tab open. yt-dlp-ext avoids this with the **iframe trick**:

1. The extension page embeds a hidden `<iframe src="https://www.youtube.com/embed/">`
2. The content script (`MAIN` world, `all_frames: true`) injects into this iframe
3. From inside the iframe, the content script has same-origin access to YouTube — it can call `youtubei/v1/player` and fetch from YouTube's CDN

This means the extension is self-contained — clicking the extension icon opens a page that works immediately, no YouTube tab needed.

The `/embed/` endpoint specifically is used because it allows framing (no `X-Frame-Options` block).

### What this eliminates

The parent project (ytsub-v5/Zamak) uses a complex relay architecture: `BroadcastChannel` relay between MAIN/ISOLATED worlds, content port tracking, reverse/tab RPC. The iframe trick eliminates all of that — communication is a simple `postMessage` between the extension page and the iframe.

## POT bypass

YouTube's WEB client requires POT for API requests. Mobile clients (IOS, ANDROID, ANDROID_VR) don't — mobile apps have their own attestation (App Store, device integrity), so YouTube doesn't layer browser-based botguard on top.

The content script calls `youtubei/v1/player` with **ANDROID_VR client headers**. The streaming format URLs in the response work without POT. `visitorData` is extracted from `ytcfg` on the embed page.

This approach is fragile — YouTube can break it by requiring POT for mobile clients.

## Download flow

```
Extension page                          iframe (youtube.com/embed/)
     |                                        |
     |  1. postMessage: getStreamingFormats    |
     |--------------------------------------->|
     |                                        |  2. fetch youtubei/v1/player
     |                                        |     (ANDROID_VR client spoof)
     |  3. postMessage: formats list          |
     |<---------------------------------------|
     |                                        |
     |  4. User picks audio format            |
     |                                        |
     |  5. postMessage: downloadFormat         |
     |--------------------------------------->|
     |                                        |  6. Chunked fetch (5MB ranges)
     |                                        |     to YouTube CDN (same-origin)
     |  7. postMessage: ArrayBuffer            |
     |     (transferable, zero-copy)           |
     |<---------------------------------------|
     |                                        |
     |  8. Blob + browser download dialog     |
```

Key details:

- **Chunked download**: Audio is fetched in 5MB chunks via HTTP Range requests. Same-origin to YouTube CDN, so no CORS issues.
- **Zero-copy transfer**: The downloaded `ArrayBuffer` is sent back to the extension page via `postMessage` with transferables — no serialization overhead.
- **Blob download**: The extension page creates a `Blob` from the received buffer and triggers a download via `<a>.click()`. This happens in the extension page context (not the iframe), so the download works normally.

## Communication

`postMessage` RPC between extension page and iframe content script:

- **Extension page** sends `{ type: "ytdl-request", id, method, params }` to `iframe.contentWindow.postMessage(..., "https://www.youtube.com")`
- **Content script** responds with `window.parent.postMessage({ type: "ytdl-response", id, result/error }, "*")`
- **Readiness**: Content script sends `{ type: "ytdl-ready" }` on load; extension page waits for this before enabling the UI

Two RPC methods: `getStreamingFormats` (returns video metadata + format list) and `downloadFormat` (returns raw audio bytes).

## Extension structure

```
background.ts      Minimal service worker — opens index.html on action click
index.html/tsx      React UI — search input, format picker, download button
                    Embeds hidden youtube.com/embed/ iframe
content.ts          MAIN world, all_frames: true — postMessage RPC handler
                    Calls fetchPlayerApi(), chunked download via fetch()
lib/youtube.ts      fetchPlayerApi() — ANDROID_VR client spoof, format extraction
lib/iframe-rpc.ts   postMessage RPC client (extension page side)
lib/theme.ts        Dark/light theme toggle
```
