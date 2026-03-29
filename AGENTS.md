# Agent Guide

## Quick Reference

| Command           | When                                   |
| ----------------- | -------------------------------------- |
| `pnpm dev`        | Start all dev servers (web + ext)      |
| `pnpm build`      | Build web app + extension (sequential) |
| `pnpm tsc`        | Type check                             |
| `pnpm lint`       | Format + lint (with fixes)             |
| `pnpm lint-check` | Check formatting + lint (no fixes)     |
| `pnpm test-e2e`   | Run e2e tests                          |
| `pnpm release`    | Deploy web app to Cloudflare Workers   |

## Key Docs

| File                              | Purpose                      |
| --------------------------------- | ---------------------------- |
| `docs/prd.md`                     | Task list, features, roadmap |
| `docs/background/architecture.md` | Design decisions, data flow  |

## Architecture

Web app + Chrome extension (MV3) for downloading YouTube audio.

- **Web app** (`index.html` / `src/index.tsx`) — React UI, built to `dist/web/`, deployed to Cloudflare Workers
- **Content script** (`content.ts`) — MAIN world, `all_frames: true`, injected into YouTube embed iframe created by the web app. Handles YouTube player API calls and chunked audio download via same-origin fetch.
- **Background** (`background.ts`) — minimal service worker, opens web app URL on action click
- **Communication** — `postMessage` between web app and iframe content script

## Conventions

- File names: kebab-case
- Run `.ts` scripts with `node` (not `tsx`/`ts-node`)
- Prefer `undefined` over `null`
- Prefer optional properties (`{ x?: T }`) over explicit undefined (`{ x: T | undefined }`)
- Make props/params required when all call sites always pass them

## Agent Rules

- **Never run long-running tasks** (dev servers, watch modes, etc.)
- Use `pnpm build` to verify web app code, `pnpm build-ext` to verify extension code
- User runs `pnpm dev` / `pnpm dev-ext` manually in their terminal
- **Never use `--` to pass args to pnpm scripts.**

## E2E Tests

Tests use a Playwright `webServer` (Vite dev server) for the web app UI, and load the built extension via persistent Chromium context.

## Git Workflow

1. Commit logical changes separately
2. **Run `pnpm lint` before every commit**
3. Confirm with user before committing
4. **Never rebase, never amend, never force push**
