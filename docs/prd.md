# yt-dlp-ext

## TODO

- [x] chore: nest build under `dist/ext`, `dist/ext-dev`, `dist/yt-dlp-ext.zip`
- [x] chore: setup `.github`
- [ ] fix: fix inline theme script in `src/index.html`
- [ ] feat: split long audio (cf. `yt-dlp-gui`, `youtube-dl-web-v2`)
- [ ] feat: embed audio thumbnail
- [ ] feat: popup action to auto-fill search
- [ ] feat: support downloading video
- [ ] chore: icon and logo
- [ ] chore: rework prd.md
- [ ] chore: add architecture.md
- [ ] chore: publish extension
- [ ] chore: rework README.md

---

Chrome extension for downloading YouTube audio directly from the browser.

## Problem

Server-side YouTube audio downloaders broke when YouTube added POT (Proof of Origin Token) requirements. The extension bypasses this by running in the browser — a content script on `youtube.com` origin can call the player API directly.

## How it works

1. Extension page embeds a `youtube.com/embed/` iframe
2. Content script (MAIN world, `all_frames: true`) injects into the iframe
3. Content script calls YouTube's player API (same-origin, bypasses POT) to get streaming format URLs
4. Content script fetches audio in 5MB chunks via HTTP Range requests (same-origin to YouTube CDN)
5. Downloaded bytes are transferred back to the extension page via `postMessage` (transferable ArrayBuffer)
6. Extension page creates a Blob and triggers browser download dialog

## Current status

- Phase 1: Direct WebM audio download (in progress)

## Future work

- Phase 2: WASM processing — FFmpeg WASM for WebM-to-OPUS conversion with metadata (title, artist, album, thumbnail)
- Phase 3: Trimming support — libwebm WASM for fast-seek, start/end time UI
