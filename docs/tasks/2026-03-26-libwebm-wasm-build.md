# libwebm WASM build — self-fork from youtube-dl-web-v2

## Why

`@hiogawa/ffmpeg@1.0.0-pre.6` (published 2022-11-20) ships an Emscripten JS glue that uses `new Function()` in embind's `createNamedFunction`. This is blocked by MV3 extension CSP (`wasm-unsafe-eval` allows WASM but not `eval`/`new Function`). See [PR comparison](./2026-03-26-fast-seek-pr-comparison.md#emscripten-csp-issue).

Fix: rebuild with `-sDYNAMIC_EXECUTION=0` (tells Emscripten to avoid `new Function()`/`eval()` in generated glue). Since the package is 3+ years old and pinned at a pre-release, self-forking the needed bits is cleaner than patching.

## What to copy from youtube-dl-web-v2

Source: `~/code/personal/youtube-dl-web-v2/packages/ffmpeg/`

### Your C++ code (~770 lines)

| File                                 | Lines | Purpose                                                   |
| ------------------------------------ | ----- | --------------------------------------------------------- |
| `src/cpp/ex01-emscripten.cpp`        | 19    | Embind bindings: `parseMetadataWrapper`, `remuxWrapper`   |
| `src/cpp/utils-webm.hpp`             | 376   | WebM header parsing, cue point extraction, frame remuxing |
| `src/cpp/utils.hpp`                  | 209   | Assertions, debug helpers                                 |
| `src/cpp/nlohmann-json-optional.hpp` | 74    | JSON serialization for optional fields                    |

### Dependencies (fetched at build time)

| Dependency    | Version  | How                                                          |
| ------------- | -------- | ------------------------------------------------------------ |
| libwebm       | 1.0.0.29 | Meson wrap, cloned from `github.com/webmproject/libwebm.git` |
| nlohmann/json | 3.11.2   | Meson wrap, header-only                                      |

### Build infra

| File                              | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `meson.build`                     | Build definition — compiles ex01-emscripten target   |
| `subprojects/libwebm.wrap`        | Meson dependency: libwebm git clone                  |
| `meson-cross-file-emscripten.ini` | Emscripten toolchain paths                           |
| `Dockerfile`                      | `FROM emscripten/emsdk:3.1.24`, installs meson+ninja |
| `docker-compose.yml`              | Runs build inside Docker                             |

### Emscripten flags

Current (from youtube-dl-web-v2):

```
--bind -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 --minify 0
```

Add for CSP fix:

```
-s DYNAMIC_EXECUTION=0
```

## Proposed code organization

```
packages/libwebm/
├── src/
│   ├── ex01-emscripten.cpp       # embind bindings
│   ├── utils-webm.hpp            # WebM parse/remux logic
│   ├── utils.hpp                 # utilities
│   └── nlohmann-json-optional.hpp
├── subprojects/
│   ├── libwebm.wrap              # meson dependency
│   └── nlohmann_json.wrap
├── meson.build
├── meson-cross-file-emscripten.ini
├── Dockerfile
├── build.sh                      # docker build + copy output
└── dist/
    ├── ex01-emscripten.js        # committed build output
    └── ex01-emscripten.wasm
```

`src/lib/libwebm.ts` imports from `../packages/libwebm/dist/` instead of `@hiogawa/ffmpeg`.

### Why commit build output

Developers don't need emsdk locally — the Docker build is for CI or when C++ changes. The JS+WASM output is committed so `pnpm build` works without Docker/Emscripten. Same pattern as the npm package (shipped pre-built).

### Why meson over raw emcc

Could do a single `em++` command, but meson:

- Handles libwebm's 25 source files cleanly via subproject
- Already works (tested in youtube-dl-web-v2)
- Cross-file separates toolchain config from build logic

### Alternative: raw emcc script

If meson feels heavy for one target:

```bash
em++ --bind \
  -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s DYNAMIC_EXECUTION=0 \
  -I subprojects/libwebm-1.0.0.29/webm_parser/include \
  -I subprojects/libwebm-1.0.0.29 \
  -I subprojects/nlohmann_json/single_include \
  src/ex01-emscripten.cpp \
  subprojects/libwebm-1.0.0.29/webm_parser/src/*.cc \
  subprojects/libwebm-1.0.0.29/mkvmuxer/*.cc \
  -o dist/ex01-emscripten.js
```

This works but requires manually cloning libwebm+nlohmann first. Tradeoff: simpler build file, more manual setup.

## Build flow

```
Developer changes C++
  → docker compose run build    # or: ./build.sh
    → emsdk 3.1.24 container
    → meson setup + compile
    → produces dist/ex01-emscripten.{js,wasm}
  → commit dist/ changes
  → pnpm build picks up from dist/
```

## Verification

After rebuilding, grep the JS glue for `new Function` — should be gone with `-sDYNAMIC_EXECUTION=0`. Run the e2e trim test to confirm WASM loads without CSP errors.

## Status

- [ ] Copy C++ source files
- [ ] Copy build infra (meson.build, wraps, Dockerfile)
- [ ] Add `-sDYNAMIC_EXECUTION=0` to link flags
- [ ] Docker build, verify output
- [ ] Update `src/lib/libwebm.ts` imports to use local dist
- [ ] Remove `@hiogawa/ffmpeg` dependency
- [ ] E2e trim test passes
