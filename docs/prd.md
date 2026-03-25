# yt-dlp-ext — Task List

Chrome extension for downloading YouTube audio directly from the browser. See [./background/architecture.md](./background/architecture.md) for design decisions, [./background/references.md](./background/references.md) for prior projects.

## Done

- [x] chore: project scaffold (Vite + React 19 + TypeScript + Tailwind 4)
- [x] chore: setup `.github`
- [x] chore: nest build under `dist/ext`, `dist/ext-dev`, `dist/yt-dlp-ext.zip`
- [x] feat: MVP — search video, pick audio format, download file
- [x] chore: rework prd.md
- [x] chore: add architecture.md, references.md
- [x] chore: rework README.md

## TODO

- [ ] feat: metadata fields — title/artist/album input before download
- [ ] feat: WASM processing — FFmpeg WASM for WebM-to-OPUS conversion with metadata embedding
- [ ] feat: thumbnail embedding — embed video thumbnail as album art
- [ ] feat: trimming — libwebm WASM for fast-seek, start/end time UI
- [ ] feat: download progress — show chunk progress during download
- [ ] feat: popup action to auto-fill search
- [ ] fix: fix inline theme script in `src/index.html`
- [ ] refactor: type-safe rpc
- [ ] refactor: react-query for async logic
- [ ] chore: icon and logo

## Backlog

- [ ] chore: publish extension
- [ ] feat: support downloading video
