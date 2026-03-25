// Thin wrapper around the @hiogawa/ffmpeg ex01 Emscripten module (libwebm WASM).
// Provides parseMetadata() and remux() for fast-seek download.

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

/** Parse the EBML header of a WebM file to extract cue points and track info. */
export async function parseMetadata(
  buffer: Uint8Array,
): Promise<SimpleMetadata> {
  const mod = await getModule();
  const vec = new mod.embind_Vector();
  vec.resize(buffer.length, 0);
  vec.view().set(buffer);
  const json = mod.embind_parseMetadataWrapper(vec);
  return JSON.parse(json) as SimpleMetadata;
}

/** Remux partial WebM data (metadata header + selected clusters) into a valid WebM file. */
export async function remux(
  metadataBuffer: Uint8Array,
  frameBuffer: Uint8Array,
  fixTimestamp = true,
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
