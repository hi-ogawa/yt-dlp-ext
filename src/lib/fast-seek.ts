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
//   - headerSize() is new (original passed entire initial fetch to remux)

import type { SimpleMetadata } from "@hiogawa/ffmpeg/build/tsc/cpp/ex01-emscripten-types";

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
export function findContainingRange(
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

/**
 * Compute the header size — the number of bytes from the start of the file
 * up to (but not including) the first Cluster element.
 * This is the metadata portion needed for remuxing.
 *
 * New in this port — original passed the entire initial fetch buffer to remux.
 * Trimming to just the metadata avoids sending trailing cluster data as "metadata".
 */
export function headerSize(metadata: SimpleMetadata): number {
  const { segment_body_start, cue_points } = metadata;
  if (!segment_body_start || cue_points.length === 0) return 0;
  const firstCue = cue_points[0];
  if (firstCue?.cluster_position === undefined) return 0;
  return segment_body_start + firstCue.cluster_position;
}
