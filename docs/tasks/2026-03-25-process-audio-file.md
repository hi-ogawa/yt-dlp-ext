# Process audio file — OPUS with metadata

Goal: download produces a `.opus` file with proper metadata (title, artist, album, thumbnail) instead of a raw `.webm`.

## Scope

In scope:

- Metadata fields UI (title, artist, album) — pre-filled from video info, editable before download
- Thumbnail fetching and embedding as album art
- WebM-to-OPUS remux with metadata embedding (container change, no re-encoding)

Out of scope:

- Trimming / start-end time UI (separate feature)
- libwebm fast-seek optimization (separate feature)
- Download progress indicator (separate feature)

## Approaches

### Option A: Mediabunny (recommended)

Reference: `~/code/others/mediabunny` (Vanilagy/mediabunny)

Pure TypeScript library (~70 KB gzipped, tree-shakable) that handles media file conversion. Supports WebM demuxing, OGG/Opus muxing, and metadata with cover art — exactly our use case.

Key findings from source review:

- **Passthrough remux**: when source codec matches target (Opus→Opus), copies encoded packets directly without decode/re-encode (`conversion.ts:1372`: "Fast path, we can simply copy over the encoded packets")
- **Metadata API**: `output.setMetadataTags({ title, artist, album, images })` — first-class support for Vorbis comments + FLAC picture block for album art
- **OGG muxer** (`ogg-muxer.ts`): handles OpusHead, OpusTags (Vorbis comments), page segmentation, granule positions, CRC — all the tricky bits
- **No WASM, no SharedArrayBuffer, no CSP issues** — works in Chrome extension without workarounds

Usage:

```ts
import {
  Input,
  Output,
  Conversion,
  BlobSource,
  BufferTarget,
  OggOutputFormat,
} from "mediabunny";

const input = new Input({
  source: new BlobSource(webmBlob),
  formats: [
    /* matroska */
  ],
});
const output = new Output({
  target: new BufferTarget(),
  format: new OggOutputFormat(),
});
output.setMetadataTags({
  title: "Video Title",
  artist: "Channel Name",
  album: "Album",
  images: [{ data: jpegBytes, mimeType: "image/jpeg", kind: "coverFront" }],
});
const conversion = await Conversion.init({ input, output });
await conversion.execute();
// output.target.buffer → .opus file with metadata + cover art
```

Pros:

- npm install, zero config
- Handles all the hard parts (EBML parsing, OGG page writing, Vorbis comments, FLAC picture block, granule positions)
- Pure TS, small, tree-shakable
- Progress callback (`conversion.onProgress`)
- Active project (by the author of `webm-muxer` / `mp4-muxer`)

Cons:

- External dependency (~70 KB)
- Relatively new library — may hit edge cases
- Uses WebCodecs API internally for transcoding (but not needed for our passthrough path)

### Option B: Port FFmpeg WASM from youtube-dl-web-v2

Reference: `~/code/personal/youtube-dl-web-v2`

Custom minimal FFmpeg built with Emscripten. C++ wrapper calls libavformat to remux WebM→OGG with metadata. Uses `flac-picture` package for thumbnail embedding.

Pros:

- Proven, battle-tested
- Handles all edge cases

Cons:

- Large WASM binary (~2-3 MB)
- Complex build (Emscripten + Docker + FFmpeg configure)
- pthreads require `SharedArrayBuffer` — problematic in extension context (no control over CORS headers)
- Heavy dependency for a remux

### Option C: Pure JS DIY

Write WebM parser + OGG writer from scratch. Reference implementations:

- `opus-accumulator` (`~/code/others/opus-accumulator`) — tiny OGG page writer (~3 KB)
- `flac-picture` from youtube-dl-web-v2 — JPEG→FLAC picture block encoder (~60 lines)

Pros:

- Zero dependencies, minimal code
- Full control

Cons:

- Significant implementation work (EBML parsing, OGG page segmentation, granule position calculation)
- Need to handle edge cases that Mediabunny already handles

### Option D: ffmpeg.wasm (community)

`@ffmpeg/ffmpeg` npm package.

Pros:

- npm install

Cons:

- Full FFmpeg (~25 MB WASM), massive overkill
- SharedArrayBuffer required (multi-threaded) or blocks main thread (single-threaded)
- CSP issues in extension context

## Recommendation

**Option A (Mediabunny)** — it solves the exact problem with minimal integration effort. Falls back to Option C if we hit issues.

## Implementation steps

### Step 1: Add Mediabunny dependency

- `pnpm add mediabunny`
- Verify it builds and tree-shakes correctly with Vite

### Step 2: Metadata fields UI

- Add title/artist/album input fields to `DownloadForm`
- Pre-fill title from `data.video.title`, artist from `data.video.channelName`
- Album left empty by default
- Fields are editable before download

### Step 3: Thumbnail fetching

- Fetch `https://i.ytimg.com/vi/{videoId}/hqdefault.jpg` as `Uint8Array` in the content script (same-origin to `i.ytimg.com` from YouTube context)
- Pass thumbnail bytes back to extension page alongside audio data

### Step 4: Web Worker for conversion

- Mediabunny runs wherever you call it — no internal worker. For multi-MB audio files, running on main thread would freeze the UI during EBML parsing and OGG page writing.
- Create a dedicated Web Worker (`src/lib/convert-worker.ts`) that:
  - Receives WebM `ArrayBuffer` + metadata + thumbnail JPEG bytes via `postMessage` (transferable)
  - Runs Mediabunny `Conversion` (BlobSource → BufferTarget, OggOutputFormat, metadata tags)
  - Returns OPUS `ArrayBuffer` via `postMessage` (transferable)
- Extension page side: thin wrapper that posts to worker and returns a promise
- Worker pattern: similar to youtube-dl-web-v2's Comlink approach, but simpler (single function, no need for Comlink — plain postMessage suffices)

### Step 5: WebM→OPUS conversion

- After download completes, send WebM bytes to the worker
- Worker uses Mediabunny `Conversion` API:
  - Input: WebM blob
  - Output: OGG/Opus with `BufferTarget`
  - Set metadata tags (title, artist, album, cover art)
- Worker returns OPUS bytes to main thread
- Create blob from output, trigger download with `.opus` extension

### Step 6: Wire up end-to-end

- Integrate conversion into the download flow
- Handle progress (Mediabunny provides `onProgress` callback — relay via postMessage)
- Error handling for conversion failures (fall back to raw WebM download?)

## Open questions

1. **Mediabunny bundle size impact** — need to verify how much it adds after tree-shaking (we only use Matroska demux + OGG mux + metadata)
2. **Vite worker bundling** — need to verify Mediabunny works when bundled into a Web Worker via Vite's `?worker` or manual `new Worker()` import. Extension build uses IIFE for content script but standard build for the extension page, so workers from the page should work.
3. **Thumbnail fetch origin** — `i.ytimg.com` images may need to be fetched from the content script (same-origin context) rather than the extension page. Need to verify.

## Status

- [ ] Plan written, waiting for feedback
