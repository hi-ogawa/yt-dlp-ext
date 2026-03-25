# References — Prior Projects

yt-dlp-ext is an extension port of the same download concept from prior projects. The core idea — fetch YouTube player API with mobile client headers, download audio via chunked range requests — is shared across all three downloaders. The extension form factor solves the POT problem that broke the server-side approach. The iframe trick originates from ytsub-v5's extension architecture.

## youtube-dl-web-v2

Web app on Cloudflare Workers. Server proxies YouTube API calls and CDN range requests. Client-side FFmpeg WASM converts WebM to OPUS with metadata, libwebm WASM handles trimming.

**Broke when YouTube added POT** — server can't generate proof-of-origin tokens, only in-browser botguard JS can. This made the server proxy approach unreliable.

Repo: `~/code/personal/youtube-dl-web-v2`

## yt-dlp-gui

Electron desktop app. Spawns system `yt-dlp` + `ffmpeg` binaries for download and processing. Works (yt-dlp keeps up with YouTube changes), but requires desktop + system dependencies.

**Still works**, but not portable — can't run in a browser, needs yt-dlp and ffmpeg installed.

Repo: `~/code/personal/yt-dlp-gui`

## ytsub-v5 (Zamak)

Chrome extension + web app for language learning via YouTube subtitles. The download feature was prototyped here first — content script on `youtube.com` fetches player API with mobile client headers, downloads audio in chunks.

**Origin of the iframe trick**: ytsub-v5 considered but didn't need the iframe approach (it already has a content script on YouTube tabs for subtitle fetching). The idea was documented in `docs/tasks/2026-03-15-extension-idb-cross-origin-bug.md` as an alternative for cross-origin access. yt-dlp-ext adopted it because it doesn't need a YouTube tab at all.

**Origin of the download code**: `fetchPlayerApi`, chunked range download, and the postMessage RPC pattern were prototyped in ytsub-v5 and extracted into yt-dlp-ext as a standalone project.

**Model for project organization**: yt-dlp-ext follows ytsub-v5's patterns for project setup (Vite + vite-plus, knip, Playwright e2e), extension structure (MV3, content script + background + extension page, multi-environment Vite build), UI (React 19, Tailwind 4, Radix, Lucide, Sonner, TanStack Query), docs (`AGENTS.md`, `docs/prd.md`, `docs/tasks/`), and conventions (kebab-case, `node` for scripts, lint-before-commit). When adding features, reference ytsub-v5 for established patterns.

Repo: `~/code/personal/ytsub-v5`

## yt-dlp-ext

Browser extension. Embeds `youtube.com/embed/` iframe so a content script gets same-origin access — no server, no system dependencies. Mobile client headers bypass POT.

**What carries over from prior projects:**

- WASM processing (youtube-dl-web-v2) — FFmpeg WASM for WebM-to-OPUS, libwebm WASM for trimming (planned)
- Metadata embedding (yt-dlp-gui) — title, artist, album, thumbnail (planned)
- Mobile client spoofing (both) — ANDROID_VR headers to avoid POT

**What's new:**

- Iframe trick — no server, no YouTube tab needed
- Runs anywhere Chrome runs — no system dependencies

## Comparison

|              | youtube-dl-web-v2             | yt-dlp-gui                | ytsub-v5                                 | yt-dlp-ext                    |
| ------------ | ----------------------------- | ------------------------- | ---------------------------------------- | ----------------------------- |
| Purpose      | Audio download                | Audio download            | Subtitle learning (+ download prototype) | Audio download                |
| Form factor  | Web app (server)              | Desktop (Electron)        | Extension + web app                      | Extension                     |
| Download     | Server proxies range requests | System yt-dlp binary      | Content script on YouTube tab            | Same-origin fetch via iframe  |
| Processing   | FFmpeg/libwebm WASM           | System ffmpeg             | N/A                                      | FFmpeg/libwebm WASM (planned) |
| POT impact   | Broken                        | Works (yt-dlp handles)    | Works (same-origin)                      | Works (mobile client bypass)  |
| Dependencies | Cloudflare Workers            | yt-dlp + ffmpeg installed | Server (Cloudflare Workers)              | None                          |
