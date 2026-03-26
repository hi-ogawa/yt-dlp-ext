# Fast-seek download — PR comparison

Comparing three implementations of fast-seek download from `2026-03-25-fast-seek-download.md`.

All three PRs pass CI (build + e2e). All three have real bugs that would prevent correct operation.

## Bugs found per PR

### PR #9 (Option B: Pure TS EBML + custom remux)

1. **`findContainingRange` end-boundary truncation** — When the end time is near the end of the file, `endIdx = Math.min(i + 1, cuePoints.length - 1)` clamps to the last cue's cluster start instead of returning `undefined` (download to EOF). This **cuts off the final cluster's data**, producing truncated audio.

2. **No fallback for short videos** — If cue points are empty or header parsing fails, `parseWebmHeader` returns `undefined`, which throws `"Could not parse WebM header"` with no fallback to full download. Short videos with 0-1 cue points will error out.

3. **Linear scan instead of binary search** in `findContainingRange`. Works but O(n) on cue count — thousands of cue points for long videos.

4. **Cluster Timecodes not rewritten** — The remuxed output keeps original absolute timestamps. A clip starting at 1:00 produces a WebM whose first cluster has Timecode=60000. The `remuxWebm` function writes `EBML header + Segment(unknown-size) + Info + Tracks + raw clusters`, which is structurally valid, but the non-zero-start timestamp may cause mediabunny to produce an Opus file with wrong timing (leading silence or offset).

5. **Cues-before-Info ordering** — If Cues appears before Info in the Segment (spec allows any order), `parseCues` is called with the default `timecodeScale=1_000_000` before the real value is parsed from Info. YouTube files always have Info first, so this is theoretical.

6. **Fixed 512KB header fetch, no retry** — No adaptive sizing, no SeekHead fallback. Long videos with many cue points may have Cues exceeding 512KB.

### PR #10 (Option A: libwebm WASM)

1. **Use-after-transfer of ArrayBuffer** (fatal) — In `index.tsx`'s `downloadFastSeek`, `headerResult.data` is transferred to the worker via `workerRpc.parseWebmHeader({ headerData: headerResult.data })`. The postMessage transferable detection in `worker-rpc.ts` finds the ArrayBuffer and transfers it (neutering it on the main thread). Then later: `headerResult.data.slice(0, metaSize)` — **this accesses a detached ArrayBuffer and will throw TypeError at runtime.**

2. **Time unit mismatch** (fatal) — `findContainingRange` compares raw cue point `time` values (milliseconds from WASM parser) against `startTime`/`endTime` (seconds from `parseTime`). A user requesting 60s will be compared against cue times like 60000ms. The binary search will always find `startIdx=0` and `endIdx=undefined`, so **fast-seek always downloads the entire file**.

3. **Two separate `fetchPlayerApi` calls per download** — `downloadHeader` and `downloadRange` each call `resolveFormatUrl()` → `fetchPlayerApi()`. Two redundant YouTube API requests per fast-seek. Worse: YouTube URLs are signed and time-limited, so the URL from the first call may differ from the second. Byte ranges from header parsing may not match the data fetched with a different URL.

4. **No format validation** — Fast-seek path assumes WebM but the user could select an M4A format (itag 140). WASM parser will crash or produce garbage.

Note: The ex01 WASM module is clean — no pthreads, no SharedArrayBuffer, no filesystem I/O. Just two embind functions doing pure in-memory buffer processing (353KB). No fundamental issues running in a Web Worker inside a Chrome extension.

### PR #11 (Option C: Pure TS EBML parser, no remux)

1. **No remux — cluster timestamps are wrong** (functional bug) — Assembled WebM is `header bytes + selected cluster bytes` with no timestamp adjustment. A clip starting at 1:00 has first cluster Timecode=60000. Mediabunny will demux packets with original timestamps, producing an Opus file that "starts" at 60 seconds. Players may show leading silence or wrong duration.

2. **Stale Cues in assembled output** — The header includes the original Cues element with byte positions referencing the original file. In the assembled file, those offsets are meaningless. If mediabunny consults Cues during conversion, it reads from wrong positions.

3. **No exact trimming** — Downloaded clusters span wider than the requested time range (due to cluster boundaries). `startTime`/`endTime` are never passed to `convertWebmToOpus`. User requests 1:00-1:30 but gets ~0:58-1:35 of audio.

4. **`readElementSize` only handles 1-byte unknown-size** — Checks `firstByte === 0xff` but EBML unknown-size can be multi-byte (e.g. 8-byte `0x01FFFFFFFFFFFFFF`, common for Segment). Multi-byte unknown-size falls through to `readVarInt`, which returns a huge number instead of `undefined`. YouTube Segments commonly use 8-byte unknown-size.

5. **Header truncation if > 256KB** — Initial fetch is `min(10% of file, 256KB)`. If the header (EBML + SeekHead + Info + Tracks) exceeds 256KB, `initialBytes.subarray(0, headerEnd)` silently truncates because `subarray` clamps to buffer length. Assembled WebM has an incomplete header.

6. **Cues-at-end-of-file secondary fetch also capped at 256KB** — Long videos with many cue points may have Cues exceeding 256KB, returning partial cue point lists.

## Shared problems (all three PRs)

- **No trim input validation** — user can enter `end < start`, times beyond video duration, or garbage strings. No PR validates before triggering download.
- **No progress reporting** — the task doc's reference uses `ReadableStream<DownloadProgress>`. All three show nothing during multi-step fast-seek.
- **No unit tests** for EBML parsing or range computation.

## What actually matters

The three PRs differ in two fundamental design decisions:

### 1. Who does the remux?

This is the real question. Fast-seek produces `header metadata + partial clusters`. These need to become a valid WebM that mediabunny can consume.

- **#9** writes a new Segment with unknown-size wrapping Info + Tracks + raw clusters. Structurally valid but **doesn't rewrite cluster Timecodes**. The "remux" is really just reassembly with a new Segment wrapper.
- **#10** delegates to libwebm's `remuxWrapper`, which parses individual frames from partial clusters and writes a new WebM via `mkvmuxer`. This **does rewrite timestamps to start from 0**. This is the only implementation that produces correct timing.
- **#11** does no remux at all — raw concatenation.

**Verdict: Only #10 produces correctly-timed output.** But #10 has the use-after-transfer and time-unit bugs that prevent it from running at all.

### 2. Where does orchestration live?

- **#9 and #11** put everything in the content script. Simple data flow: page → content script → page → worker (conversion only).
- **#10** splits orchestration across page + content + worker. More hops: page → content (header) → page → worker (parse) → page → content (range) → page → worker (remux) → page → worker (convert). More code in `index.tsx`, more postMessage round-trips, more chance for transfer bugs (which it has).

#10's split is motivated by WASM needing to run in the worker, but the extra round-trips introduced the use-after-transfer bug and the redundant `fetchPlayerApi` calls.

## Recommendation

**None of these PRs are merge-ready.** All have bugs that prevent correct operation.

**Best starting point: PR #10 (Option A)**, because it's the only one with correct remuxing (timestamp rewriting via libwebm). The bugs are fixable:

| Bug                   | Fix                                                                                  | Status |
| --------------------- | ------------------------------------------------------------------------------------ | ------ |
| Time unit mismatch    | Divide cue point times by 1000 in `findContainingRange`                              | Fixed  |
| fix_timestamp default | Changed from `true` to `false` to match original                                     | Fixed  |
| Emscripten CSP block  | Embind's `createNamedFunction` uses `new Function()`, blocked by MV3 extension CSP   | TODO   |
| Use-after-transfer    | Clone the header ArrayBuffer before sending to worker, or restructure to keep a copy | TODO   |
| Double fetchPlayerApi | Cache the resolved URL, or pass URL from `downloadHeader` to `downloadRange`         | TODO   |

### Emscripten CSP issue

Discovered during e2e testing: the fast-seek path fails at runtime in the Chrome extension because Emscripten's embind uses `new Function()`. MV3 extensions apply a default CSP of `script-src 'self' 'wasm-unsafe-eval'` — `wasm-unsafe-eval` allows WASM instantiation but does NOT allow `eval()` / `new Function()`.

The offending code is in `node_modules/@hiogawa/ffmpeg/build/emscripten/Release/ex01-emscripten.js:3178-3181`:

```js
function createNamedFunction(name, body) {
  name = makeLegalFunctionName(name);
  return new Function(
    "body",
    "return function " +
      name +
      "() {\n" +
      '    "use strict";' +
      "    return body.apply(this, arguments);\n" +
      "};\n",
  )(body);
}
```

The `createNamedFunction` call is cosmetic — it creates a function with a specific `.name` property for debugging. It can be patched to just return the body function directly without affecting functionality.

Options:

1. Patch the Emscripten JS glue at build time (Vite plugin or post-build script) to replace `createNamedFunction` with a no-op wrapper
2. Add `'unsafe-eval'` to the extension CSP — but Chrome Web Store may reject this
3. Rebuild the WASM module with newer Emscripten that has `-sEMBIND_AOT` (avoids dynamic codegen)

The existing e2e tests didn't catch this because the full download path doesn't touch the WASM/worker code for parsing/remux. Only the fast-seek trim path triggers it.

**Cherry-pick from #11**: SeekHead-based Cues-at-end-of-file fallback. Neither #9 nor #10 handle this.

**If WASM is undesirable**: Start from #9 but the custom "remux" doesn't rewrite timestamps either — it would need the same cluster-Timecode rewriting that libwebm does, which is essentially writing a real remuxer in TS. At that point, using libwebm WASM is simpler.

## PR #10 porting accuracy vs youtube-dl-web-v2

PR #10 is a port of the fast-seek flow from `youtube-dl-web-v2`. This section documents what was ported faithfully, what was intentionally changed, and what was lost in translation.

### Reference files

| youtube-dl-web-v2                                 | PR #10                             |
| ------------------------------------------------- | ---------------------------------- |
| `packages/app/src/utils/worker-client-libwebm.ts` | `src/lib/fast-seek.ts`             |
| `packages/app/src/worker/libwebm.ts`              | `src/lib/libwebm.ts`               |
| `packages/app/src/utils/download.ts`              | `src/index.tsx` (downloadFastSeek) |

### Faithful ports

- **`findContainingRange` core logic** — same algorithm: find last cue with `time <= startTime`, first cue with `time > endTime`, return absolute byte positions (`segment_body_start + cluster_position`). Byte position math is identical.
- **WASM API calls** — `embind_parseMetadataWrapper` and `embind_remuxWrapper` called with same signatures. `arrayToVector` pattern (`.resize()` + `.view().set()`) preserved.
- **Chunk download** — 5MB chunk size, Range header format, streaming reader loop — all match.

### Intentional changes

| Change               | Original                                                      | PR #10                                        | Assessment                                              |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Range search         | Linear (`.reverse().find()`, `.find()`)                       | Binary search                                 | Correct, minor optimization                             |
| startTime/endTime    | Optional, falsy → use first/last cue                          | Required, caller defaults to 0/duration       | Equivalent behavior                                     |
| Error handling       | `tinyassert()` throws                                         | Returns `{ start: 0 }` fallback               | Defensive, hides errors                                 |
| Header fetch size    | `max(filesize * 0.001, 1KB)` (dynamic)                        | Fixed 512KB                                   | Different tradeoff                                      |
| headerSize()         | Not present; entire initial fetch passed as metadata to remux | Trims to first cluster offset                 | Improvement — avoids sending cluster data as "metadata" |
| Worker communication | Comlink with `?url` imports + explicit `transfer()`           | Hand-rolled postMessage RPC, direct JS import | Architectural change                                    |
| Progress reporting   | `ReadableStream<DownloadProgress>` with offset/total/ratio    | `Promise<ArrayBuffer>`, no progress           | Regression                                              |
| Cancellation         | `cancelled` flag + `ReadableStream.cancel()`                  | None                                          | Regression                                              |

### Bugs introduced during porting

1. **`time / 1000` dropped** (fixed in this branch) — Original: `{ time: time / 1000, cluster_position }`. PR omitted the division. Cue times are milliseconds from libwebm, user times are seconds from `parseTime()`. Without conversion, binary search compares seconds vs milliseconds → always selects entire file.

2. **`fix_timestamp` default flipped** (fixed in this branch) — Original: `Module.embind_remuxWrapper(meta, frame, false)`. PR defaulted to `true`. Now fixed to `false` to match original.

3. **Use-after-transfer** — Original used Comlink `transfer()` explicitly on specific buffers. PR's auto-transfer detection in `worker-rpc.ts` transfers `headerResult.data` to the worker (neutering it), then tries to `.slice()` it later for the remux metadata. Original didn't have this problem because it kept the metadata buffer on the client side and only transferred the frame buffer.

4. **Double `fetchPlayerApi`** — Original used a single server proxy (`fetchDownload`) with a persistent format URL. PR's `downloadHeader` and `downloadRange` each independently call `resolveFormatUrl()` → `fetchPlayerApi()`. Two full YouTube API round-trips, with risk of getting different signed URLs.

5. **WASM memory leak** — Original's `arrayToVector` created `embind_Vector` objects without cleanup too, so this is inherited, not introduced. Minor — the vectors are small relative to the data they hold, and downloads are infrequent.
