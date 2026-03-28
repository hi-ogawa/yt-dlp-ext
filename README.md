# yt-dlp-ext

Download YouTube audio directly from your browser — no server, no system dependencies.

**[https://yt-dlp-ext.hiro18181.workers.dev/](https://yt-dlp-ext.hiro18181.workers.dev/)**

The web app requires the Chrome extension to be installed. The extension handles YouTube API calls and audio download — the web app is the UI.

## Install extension

1. Download `yt-dlp-ext.zip` from [releases](https://github.com/hi-ogawa/yt-dlp-ext/releases)
2. Go to `chrome://extensions`, enable Developer mode
3. Drag and drop the zip file

## Development

```bash
pnpm i

# Start dev rebuild watch, then load dist/ext-dev as unpacked extension in Chrome
pnpm dev

# Deploy web app to Cloudflare Workers
pnpm build
pnpm release
```
