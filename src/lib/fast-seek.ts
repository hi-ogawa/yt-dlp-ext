// Fast-seek utilities for computing byte ranges from WebM cue points.
//
// Ported from youtube-dl-web-v2:
//   packages/app/src/utils/worker-client-libwebm.ts — findContainingRange()
//   packages/app/src/utils/download.ts — downloadFastSeek() orchestration
//
// Changes from original:
//   - Binary search instead of linear scan (original used .reverse().find())
//   - startTime/endTime required (caller provides defaults), original had them optional
//   - Graceful fallback ({ start: 0 }) instead of tinyassert on missing data

import type { SimpleMetadata } from "@hiogawa/ffmpeg/build/tsc/cpp/ex01-emscripten-types";
import type { ContentRpc } from "../content-rpc.ts";
import type { WorkerRpc } from "../worker-rpc.ts";

interface ByteRange {
  /** Absolute byte offset to start downloading (inclusive). */
  start: number;
  /** Absolute byte offset to stop downloading (exclusive). Undefined = download to end. */
  end?: number;
}

/**
 * Given parsed WebM metadata and a time range, compute the byte range
 * that contains all clusters spanning [startTime, endTime].
 *
 * Cue points map timestamps to cluster byte positions. We find:
 * - The last cue point whose time <= startTime (start of first needed cluster)
 * - The first cue point whose time > endTime (start of first unneeded cluster = our end)
 *
 * Byte positions in cue points are relative to the segment body start.
 *
 * Original: worker-client-libwebm.ts findContainingRange()
 */
function findContainingRange(
  metadata: SimpleMetadata,
  startTime: number,
  endTime: number,
): ByteRange {
  const { cue_points, segment_body_start } = metadata;
  if (!segment_body_start || cue_points.length === 0) {
    // No cue points available — must download the entire file
    return { start: 0 };
  }

  // Cue points are sorted by time. Extract (time, position) pairs.
  // Original does: { time: time / 1000, cluster_position }
  // Cue point times from libwebm are in milliseconds, convert to seconds
  // to match startTime/endTime (parsed from user input in seconds).
  const cues = cue_points
    .filter((c) => c.time !== undefined && c.cluster_position !== undefined)
    .map((c) => ({
      time: c.time! / 1000,
      position: segment_body_start + c.cluster_position!,
    }));

  if (cues.length === 0) {
    return { start: 0 };
  }

  // Find the last cue with time <= startTime (binary search)
  // Original: [...cuePoints].reverse().find((c) => c.time <= startTime)
  let startIdx = 0;
  {
    let lo = 0;
    let hi = cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid]!.time <= startTime) {
        startIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }

  // Find the first cue with time > endTime
  // Original: cuePoints.find((c) => c.time > endTime)
  let endIdx: number | undefined;
  {
    let lo = 0;
    let hi = cues.length - 1;
    let result: number | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid]!.time > endTime) {
        result = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    endIdx = result;
  }

  const range: ByteRange = { start: cues[startIdx]!.position };
  if (endIdx !== undefined) {
    range.end = cues[endIdx]!.position;
  }

  return range;
}

// Initial header fetch size. WebM headers with Cues are typically small,
// but YouTube files may have many cue points. 512 KB is generous.
const HEADER_FETCH_SIZE = 512 * 1024;

/** Fast-seek download: fetch only the byte ranges containing the requested time span. */
export async function downloadFastSeek(opts: {
  rpc: ContentRpc;
  workerRpc: WorkerRpc;
  videoId: string;
  itag: number;
  startTime: number;
  endTime: number;
}): Promise<ArrayBuffer> {
  const { rpc, workerRpc, videoId, itag, startTime, endTime } = opts;

  // 1. Download header bytes (contains EBML header + Cues)
  const headerResult = await rpc.downloadHeader({
    videoId,
    itag,
    bytes: HEADER_FETCH_SIZE,
  });

  // 2. Parse header with libwebm WASM to extract cue points
  // Clone before sending: workerRpc transfers the ArrayBuffer (neutering it),
  // but we still need headerResult.data below for the metadataSlice.
  const metadata = await workerRpc.parseWebmHeader({
    headerData: headerResult.data.slice(0),
  });

  // 3. Compute byte range from cue points
  const range = findContainingRange(metadata, startTime, endTime);

  // 4. Download only the needed clusters
  const clusterData = await rpc.downloadRange({
    videoId,
    itag,
    start: range.start,
    end: range.end,
  });

  // 5. Remux: combine header metadata + partial clusters into valid WebM.
  // Pass the full header fetch as metadata — remuxWrapper re-parses it internally,
  // and cutting it to just the pre-cluster bytes causes the C++ parser to return
  // a non-ok status (buffer ends mid-parse). Original also passed the full fetch.
  const remuxedData = await workerRpc.remuxWebm({
    metadataBuffer: headerResult.data,
    frameBuffer: clusterData.data,
  });

  return remuxedData;
}
