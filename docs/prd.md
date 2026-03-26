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
- [x] feat: metadata fields — title/artist/album input before download
- [x] feat: thumbnail embedding — embed video thumbnail as album art
- [x] feat: WebM-to-OPUS conversion with metadata embedding — [task doc](./tasks/2026-03-25-process-audio-file.md)
- [x] refactor: type-safe rpc — [task doc](./tasks/2026-03-25-quick-refactoring.md)
- [x] refactor: react-query for async logic — [task doc](./tasks/2026-03-25-quick-refactoring.md)
- [x] fix: fix inline theme script in `src/index.html`
- [x] chore: icon and logo

## TODO

- [ ] feat: trimming — start/end time UI
- [ ] feat: download progress — show chunk progress during download
- [ ] feat: fast-seek download — skip unnecessary bytes when trimming — [task doc](./tasks/2026-03-25-fast-seek-download.md), [PR comparison](./tasks/2026-03-26-fast-seek-pr-comparison.md)
  - PR #10 (libwebm WASM, Option A) selected as base — [PR](https://github.com/hi-ogawa/yt-dlp-ext/pull/10)
- [ ] feat: popup action to auto-fill search
- [ ] test: looks bad now
- [ ] chore: publish extension

## Backlog

- [ ] feat: support downloading video
- [ ] fix: fast-seek use-after-transfer — `headerResult.data` transferred to worker via `parseWebmHeader`, then `.slice()`d later for remux
- [ ] fix: fast-seek double `fetchPlayerApi` — `downloadHeader` and `downloadRange` each call `resolveFormatUrl()` independently (youtube-dl-web-v2 had the same pattern)
