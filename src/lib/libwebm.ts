// Thin wrapper around the @hiogawa/ffmpeg ex01 Emscripten module (libwebm WASM).
// Provides parseMetadata() and remux() for fast-seek download.
//
// @hiogawa/ffmpeg@1.0.0-pre.6 — published 2022-11-20, same day as
//   youtube-dl-web-v2#29 "feat: download partial webm data with fast seeking".
//   The ex01 module is a thin embind wrapper around Google's libwebm (v1.0.0.29):
//     packages/ffmpeg/src/cpp/ex01-emscripten.cpp — embind bindings
//     packages/ffmpeg/src/cpp/utils-webm.hpp — parseMetadataWrapper, remuxWrapper
//   Pure in-memory computation — no pthreads, no SharedArrayBuffer, no filesystem I/O.
//   The WASM binary (public/wasm/ex01-emscripten.wasm, 353KB) is copied from this package.
//
// Ported from youtube-dl-web-v2:
//   packages/app/src/worker/libwebm.ts — LibwebmWorker class (extractWebmInfo, remux)
//   packages/app/src/utils/worker-client-libwebm.ts — Comlink client (extractWebmInfo, remuxWebm)
//
// Changes from original:
//   - Direct ESM import of Emscripten JS + locateFile for WASM, instead of
//     importScripts() + Comlink. Original used ?url imports for both JS and WASM
//     and passed URLs to worker via Comlink initialize().
//   - Lazy singleton (modulePromise) instead of explicit initialize() call.
//   - fix_timestamp default: original used false, this uses false to match.

import type {
  EmscriptenInit,
  EmscriptenModule,
  SimpleMetadata,
} from "@hiogawa/ffmpeg/build/tsc/cpp/ex01-emscripten-types";

// @ts-ignore — Vite handles CommonJS default export
import createModuleRaw from "@hiogawa/ffmpeg/build/emscripten/Release/ex01-emscripten.js";

const createModule = createModuleRaw as unknown as EmscriptenInit;

let modulePromise: Promise<EmscriptenModule> | undefined;

function getModule(): Promise<EmscriptenModule> {
  if (!modulePromise) {
    // Original: worker received URLs via Comlink initialize(), then used
    //   importScripts(moduleUrl) + init({ locateFile: () => wasmUrl })
    // Here we import the JS module directly and resolve the WASM via locateFile.
    modulePromise = createModule({
      locateFile: (path: string) => {
        if (path.endsWith(".wasm")) {
          return "wasm/ex01-emscripten.wasm";
        }
        return path;
      },
    });
  }
  return modulePromise;
}

/**
 * Parse the EBML header of a WebM file to extract cue points and track info.
 * Original: LibwebmWorker.extractWebmInfo()
 */
export async function parseMetadata(
  buffer: Uint8Array,
): Promise<SimpleMetadata> {
  const mod = await getModule();
  // Original: arrayToVector() helper did the same vec.resize + view().set() pattern
  const vec = new mod.embind_Vector();
  vec.resize(buffer.length, 0);
  vec.view().set(buffer);
  const json = mod.embind_parseMetadataWrapper(vec);
  return JSON.parse(json) as SimpleMetadata;
}

/**
 * Remux partial WebM data (metadata header + selected clusters) into a valid WebM file.
 * Original: LibwebmWorker.remux() — used fix_timestamp = false
 */
export async function remux(
  metadataBuffer: Uint8Array,
  frameBuffer: Uint8Array,
  fixTimestamp = false,
): Promise<Uint8Array> {
  const mod = await getModule();

  const metaVec = new mod.embind_Vector();
  metaVec.resize(metadataBuffer.length, 0);
  metaVec.view().set(metadataBuffer);

  const frameVec = new mod.embind_Vector();
  frameVec.resize(frameBuffer.length, 0);
  frameVec.view().set(frameBuffer);

  const resultVec = mod.embind_remuxWrapper(metaVec, frameVec, fixTimestamp);
  return new Uint8Array(resultVec.view());
}
