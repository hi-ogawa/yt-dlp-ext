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

## TODO

- [ ] feat: trimming — start/end time UI
- [ ] feat: fast-seek download — skip unnecessary bytes when trimming — [task doc](./tasks/2026-03-25-fast-seek-download.md)
- [ ] feat: download progress — show chunk progress during download
- [ ] feat: popup action to auto-fill search
- [ ] fix: fix inline theme script in `src/index.html`
- [ ] test: looks bad now
- [ ] chore: icon and logo

## Backlog

- [ ] chore: publish extension
- [ ] feat: support downloading video
