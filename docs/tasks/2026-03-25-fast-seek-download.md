# Fast-seek download — skip unnecessary bytes when trimming

Goal: when downloading a trimmed segment (start/end time), only fetch the byte ranges containing the requested time span instead of the entire file.

## How youtube-dl-web-v2 does it

Reference: `~/code/personal/youtube-dl-web-v2` — `packages/app/src/utils/download.ts`, `packages/app/src/utils/worker-client-libwebm.ts`, `packages/ffmpeg/src/cpp/utils-webm.hpp`

### The optimization

WebM files contain a **Cues** element in the header that maps timestamps to byte offsets (cluster positions). By reading only the header, you can compute which byte ranges to download.

For a 1-hour file where you want 30 seconds, this skips ~99% of the download.

### Flow

1. **Fetch header only** — first ~0.1% of file (or 1 KB minimum). Contains EBML header + SeekHead + Info + Tracks + Cues.
2. **Parse cue points** — extract `(timestamp, cluster_position)` pairs from Cues element via libwebm WASM (`extractWebmInfo`)
3. **Compute byte range** — `findContainingRange(metadata, startTime, endTime)` finds the containing clusters. This is pure JS (~30 lines): binary search cue points to find the first cluster before `startTime` and first cluster after `endTime`.
4. **Download only those bytes** — issue Range requests for just the needed clusters
5. **Remux** — reassemble metadata + partial clusters into valid WebM via libwebm WASM (`remuxWrapper`). This uses libwebm's `webm_parser` to extract frames and `mkvmuxer` to write a new valid WebM.
6. **Process** — pass the remuxed WebM to FFmpeg WASM (or Mediabunny) for OPUS conversion with metadata

### Implementation in youtube-dl-web-v2

- **libwebm WASM** (`packages/ffmpeg/src/cpp/utils-webm.hpp`): C++ wrapper around Google's libwebm. Two functions:
  - `parseMetadataWrapper(buffer)` — parses EBML header, stops at first Cluster. Returns JSON with `segment_body_start`, `track_entries`, `cue_points`.
  - `remuxWrapper(metadataBuffer, frameBuffer)` — parses frames from partial data, writes new valid WebM via `mkvmuxer`.
- **`findContainingRange()`** (`worker-client-libwebm.ts:50-81`): pure JS. Takes parsed metadata + start/end times, returns `{ start: byteOffset, end?: byteOffset }` using cue points.
- **`downloadFastSeek()`** (`download.ts:22-134`): orchestrates the flow as a `ReadableStream<DownloadProgress>`.

## Can Mediabunny handle this?

Mediabunny's Matroska demuxer parses Cues and uses them for internal seeking. But the fast-seek optimization requires:

1. **Partial file parsing** — parse just the header to get cue points, before downloading the full file. Mediabunny expects a complete input.
2. **Cue-point-to-byte-range mapping** — compute download ranges from cue points. Mediabunny doesn't expose this.
3. **Partial data remux** — reassemble metadata + selected clusters into valid WebM. Mediabunny's `Conversion` API works on complete files.

**Verdict**: Mediabunny doesn't expose the low-level primitives needed. Fast-seek requires hand-rolling or porting.

## Approaches

### Option A: Port the libwebm WASM approach

Rebuild libwebm as WASM with Emscripten, port the C++ wrapper.

Pros:

- Proven, battle-tested
- libwebm handles all WebM edge cases

Cons:

- WASM build complexity (Emscripten + libwebm)
- SharedArrayBuffer concerns in extension context (same as FFmpeg WASM)
- Maintaining a C++ build for a TypeScript project

### Option B: Pure TS EBML parser + remuxer

Port the logic to TypeScript:

- **EBML header parser** (~100-200 lines): read EBML variable-length integers, parse SeekHead/Info/Tracks/Cues, stop at first Cluster
- **`findContainingRange()`**: already pure JS, copy as-is
- **Partial WebM remuxer**: parse SimpleBlocks from cluster data, write new valid WebM with mkvmuxer-equivalent logic

Pros:

- No WASM, no build complexity
- Full control, easy to maintain

Cons:

- EBML parsing has edge cases (variable-length integers, unknown sizes, void elements)
- WebM remuxing needs correct Cluster/SimpleBlock layout
- More upfront work

### Option C: Use Mediabunny's EBML parser + custom range logic

Mediabunny already has a full EBML parser (`matroska/ebml.ts`) and cue point parsing. We could:

1. Use Mediabunny's EBML primitives to parse the header from a partial buffer
2. Extract cue points
3. Compute byte ranges (pure JS)
4. Download partial data
5. Feed the reassembled data to Mediabunny's `Conversion` for OPUS output

This depends on whether Mediabunny's reader/demuxer can work with partial data or be adapted to.

Pros:

- Reuse existing EBML parser
- Already a dependency (from the process-audio-file feature)

Cons:

- Mediabunny's internals aren't designed for partial parsing
- May need to extract/fork internal code

## Recommendation

**Option B or C** — investigate whether Mediabunny's EBML parser can be used standalone for header parsing. If not, a focused EBML header parser in TS is straightforward. The `findContainingRange()` logic is trivially portable. The remux step is the main complexity.

This is lower priority than the core OPUS conversion feature. Implement after `2026-03-25-process-audio-file.md` is complete and the trimming UI exists.

## Dependencies

- Trimming UI (start/end time fields) — no point in fast-seek without it
- `2026-03-25-process-audio-file.md` — the OPUS conversion pipeline that fast-seek feeds into

## Status

- [x] Research complete, plan written
- [x] Option B implemented: pure TS EBML parser + remuxer
- [x] Trimming UI (start/end time fields)
- [x] Fast-seek download integrated into content script RPC
