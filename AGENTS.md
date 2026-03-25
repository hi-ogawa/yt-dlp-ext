# Agent Guide

## Quick Reference

| Command         | When                    |
| --------------- | ----------------------- |
| `pnpm dev`      | Start dev rebuild watch |
| `pnpm tsc`      | Type check              |
| `pnpm lint`     | Format + lint           |
| `pnpm build`    | Build extension         |
| `pnpm test-e2e` | Run e2e tests           |

## Key Docs

| File          | Purpose                        |
| ------------- | ------------------------------ |
| `docs/prd.md` | Product doc, features, roadmap |

## Architecture

Chrome extension (MV3) that downloads YouTube audio. No server — everything runs client-side.

- **Extension page** (`index.html`) — React UI for searching videos and downloading audio
- **Content script** (`content.ts`) — MAIN world, `all_frames: true`, injected into YouTube embed iframe within the extension page. Handles YouTube player API calls and chunked audio download via same-origin fetch.
- **Background** (`background.ts`) — minimal service worker, opens extension page on action click
- **Communication** — `postMessage` between extension page and iframe content script

## Conventions

- File names: kebab-case
- Run `.ts` scripts with `node` (not `tsx`/`ts-node`)
- Prefer `undefined` over `null`
- Prefer optional properties (`{ x?: T }`) over explicit undefined (`{ x: T | undefined }`)
- Make props/params required when all call sites always pass them

## Agent Rules

- **Never run long-running tasks** (dev servers, watch modes, etc.)
- Use `pnpm build` to verify code, not `pnpm dev`
- User runs `pnpm dev` manually in their terminal
- **Never use `--` to pass args to pnpm scripts.**
- **Run `pnpm lint` before every commit**

## E2E Tests

Extension tests load the built extension in a real Chromium instance. **Must run `pnpm build` before `pnpm test-e2e`**.

## Git Workflow

1. Commit logical changes separately
2. **Run `pnpm lint` before every commit**
3. Confirm with user before committing
4. **Never rebase, never amend, never force push**
