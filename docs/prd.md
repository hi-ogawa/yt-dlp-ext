# yt-dlp-ext — Task List

Chrome extension for downloading YouTube audio directly from the browser. See [./background/architecture.md](./background/architecture.md) for design decisions.

## Done

- [x] chore: project scaffold (Vite + React 19 + TypeScript + Tailwind 4)
- [x] chore: setup `.github`
- [x] chore: nest build under `dist/ext`, `dist/ext-dev`, `dist/yt-dlp-ext.zip`
- [x] feat: MVP — search video, pick audio format, download file
- [x] chore: rework prd.md
- [x] chore: add architecture.md

## TODO

- [ ] fix: fix inline theme script in `src/index.html`
- [ ] feat: split long audio (cf. `yt-dlp-gui`, `youtube-dl-web-v2`)
- [ ] feat: embed audio thumbnail
- [ ] feat: popup action to auto-fill search
- [ ] feat: support downloading video
- [ ] chore: icon and logo
- [ ] chore: publish extension
- [ ] chore: rework README.md
- [ ] feat: WASM processing — FFmpeg WASM for WebM-to-OPUS conversion with metadata (title, artist, album, thumbnail)
- [ ] feat: Trimming support — libwebm WASM for fast-seek, start/end time UI
