# Architecture — Iframe Trick

## Problem

Server-side YouTube audio downloaders broke when YouTube added POT (Proof of Origin Token). POT is generated at runtime by botguard JS — no external server can produce it.

A content script on `youtube.com` has same-origin access, but a typical extension would require the user to have a YouTube tab open.

## Iframe trick

The extension page embeds a hidden `<iframe src="https://www.youtube.com/embed/">`. The content script (`MAIN` world, `all_frames: true`) injects into this iframe and gets same-origin access to YouTube — it can call `youtubei/v1/player` and fetch from YouTube's CDN.

The `/embed/` endpoint is used because it allows framing (no `X-Frame-Options` block). This makes the extension self-contained — no YouTube tab needed.

## POT bypass

YouTube's WEB client requires POT. Mobile clients (ANDROID_VR) don't — mobile apps have their own attestation, so YouTube doesn't layer botguard on top.

The content script calls `youtubei/v1/player` with ANDROID_VR client headers. `visitorData` is extracted from `ytcfg` on the embed page. This is fragile — YouTube can break it by requiring POT for mobile clients.
