# @yt-dlp-ext/media-utils

WebM metadata parsing and frame remuxing via libwebm WASM. Used by yt-dlp-ext for fast-seek download (skip unnecessary bytes when trimming audio).

Forked from [`youtube-dl-web-v2/packages/ffmpeg`](https://github.com/hi-ogawa/youtube-dl-web-v2) (ex01 target only).

## What it does

Two functions exposed via Emscripten embind:

- **`parseMetadataWrapper(buffer)`** — parse WebM/EBML header, extract cue points (timestamp → cluster byte offset map), track entries, and segment metadata. Returns JSON string.
- **`remuxWrapper(metadata, frames, fixTimestamp)`** — combine header metadata + partial cluster data into a valid WebM file. Used after downloading only the byte ranges needed for a time span.

## Dependencies

- [libwebm](https://github.com/webmproject/libwebm) v1.0.0.29 — Google's WebM parser (`webm_parser`) and muxer (`mkvmuxer`)
- [nlohmann/json](https://github.com/nlohmann/json) v3.11.2 — JSON serialization for metadata struct (header-only)

Both fetched automatically by meson at build time.

## Building

Requires Docker (no local Emscripten SDK needed):

```bash
./build.sh
```

This runs inside `emscripten/emsdk:3.1.24` + meson/ninja, producing:

```
dist/ex01-emscripten.js    # Emscripten JS glue
dist/ex01-emscripten.wasm  # WebAssembly binary (~353 KB)
```

The `dist/` output is committed so that `pnpm build` works without Docker.

## Key build flag

`-sDYNAMIC_EXECUTION=0` — tells Emscripten to avoid `new Function()` / `eval()` in the JS glue. Required for Chrome MV3 extension CSP compliance (`wasm-unsafe-eval` allows WASM but not dynamic code generation).

## C++ source files

| File                             | Lines | Purpose                                             |
| -------------------------------- | ----- | --------------------------------------------------- |
| `src/ex01-emscripten.cpp`        | 19    | Embind bindings                                     |
| `src/utils-webm.hpp`             | 376   | WebM header parsing, cue extraction, frame remuxing |
| `src/utils.hpp`                  | 209   | Assertions, debug helpers                           |
| `src/nlohmann-json-optional.hpp` | 74    | JSON serialization for optional fields              |
