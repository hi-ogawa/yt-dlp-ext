#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Build inside Docker (no local emsdk needed)
docker compose run --rm emscripten bash -c '
  meson setup build/emscripten \
    --cross-file meson-cross-file-emscripten.ini \
    --buildtype release \
    --wipe 2>/dev/null || \
  meson setup build/emscripten \
    --cross-file meson-cross-file-emscripten.ini \
    --buildtype release

  meson compile -C build/emscripten
'

# Copy output to dist/
cp build/emscripten/ex01-emscripten.js dist/
cp build/emscripten/ex01-emscripten.wasm dist/

echo "Build output:"
ls -lh dist/ex01-emscripten.*

# Verify CSP fix
if grep -q 'new Function' dist/ex01-emscripten.js; then
  echo "WARNING: dist/ex01-emscripten.js still contains 'new Function' — CSP fix may not have worked"
  exit 1
else
  echo "OK: no 'new Function' found in JS glue"
fi
