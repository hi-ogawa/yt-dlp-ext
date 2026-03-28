# yt-dlp-ext — Task List

Chrome extension + web app for downloading YouTube audio directly from the browser. See [./background/architecture.md](./background/architecture.md) for design decisions, [./background/references.md](./background/references.md) for prior projects.

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
- [x] feat: trimming — start/end time manual entry
- [x] feat: web app deploy — host UI on Cloudflare Workers, extension as backend — [task doc](./tasks/2026-03-28-web-app.md)
- [x] chore: ~~publish extension to Chrome Web Store~~ — instead, link directly to zip download + drag-and-drop install from the web app (no store review needed)
- [x] chore: rework README and architecture.md for web app architecture
- [x] chore: split build — separate web and extension targets, remove extension page (`src/index.html`)
- [x] test: restructure e2e for web app (currently tests extension page directly)
- [x] chore: background action opens hosted web app URL instead of extension page
- [x] feat: extension detection UX — show soft CTA ("Is extension installed?") after ~2s instead of hard error, link to zip download; `document_start` already gets detection under 500ms when installed

## TODO

- [ ] feat: trimming — live player seek UI — [task doc](./tasks/2026-03-28-trim-ui-with-player.md)
- [ ] feat: download progress — show chunk progress during download
- [ ] feat: fast-seek download — skip unnecessary bytes when trimming — [task doc](./tasks/2026-03-25-fast-seek-download.md)
- [ ] refactor: split src/index.tsx

## Backlog

- [ ] feat: support downloading video
- [ ] fix: fast-seek use-after-transfer — `headerResult.data` transferred to worker via `parseWebmHeader`, then `.slice()`d later for remux
- [ ] fix: fast-seek double `fetchPlayerApi` — `downloadHeader` and `downloadRange` each call `resolveFormatUrl()` independently (youtube-dl-web-v2 had the same pattern)
