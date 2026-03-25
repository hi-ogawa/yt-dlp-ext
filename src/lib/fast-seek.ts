// Fast-seek download for WebM: parse header cues, compute byte ranges,
// download only the clusters needed for a time span, remux into valid WebM.

import {
  CLUSTER_ID,
  CUECLUSTERPOSITION_ID,
  CUEPOINT_ID,
  CUETIME_ID,
  CUETRACKPOSITIONS_ID,
  CUES_ID,
  EBML_ID,
  INFO_ID,
  SEGMENT_ID,
  TIMECODE_SCALE_ID,
  TRACKS_ID,
  encodeId,
  readUint,
  readVintRaw,
  readVintSize,
} from "./ebml.ts";

// --- Types ---

interface CuePoint {
  timeMs: number;
  clusterPosition: number; // byte offset relative to Segment body
}

interface WebmHeader {
  ebmlHeaderBytes: Uint8Array; // raw EBML header element bytes
  segmentBodyOffset: number; // absolute byte offset where Segment body starts
  infoBytes: Uint8Array; // raw Info element (ID + size + body)
  tracksBytes: Uint8Array; // raw Tracks element (ID + size + body)
  cuePoints: CuePoint[];
  timecodeScale: number; // nanoseconds per tick (default 1_000_000)
}

// --- Header parsing ---

/** Size of the initial fetch for header parsing. */
export const HEADER_FETCH_SIZE = 512 * 1024; // 512 KB

/**
 * Parse a WebM header from a buffer.
 * The buffer must contain all data from file start through the Cues element.
 * Returns undefined if the buffer is too small (Cues not fully contained).
 */
export function parseWebmHeader(data: Uint8Array): WebmHeader | undefined {
  let offset = 0;

  // 1. EBML header
  const ebmlId = readVintRaw(data, offset);
  if (ebmlId.value !== EBML_ID) throw new Error("Not a WebM/EBML file");
  offset += ebmlId.length;
  const ebmlSize = readVintSize(data, offset);
  offset += ebmlSize.length;
  offset += ebmlSize.value;
  const ebmlHeaderBytes = data.slice(0, offset);

  // 2. Segment
  const segId = readVintRaw(data, offset);
  if (segId.value !== SEGMENT_ID) throw new Error("Expected Segment element");
  offset += segId.length;
  const _segSize = readVintSize(data, offset);
  offset += _segSize.length;
  const segmentBodyOffset = offset;

  // 3. Iterate top-level Segment children until first Cluster
  let infoBytes: Uint8Array | undefined;
  let tracksBytes: Uint8Array | undefined;
  let cuePoints: CuePoint[] | undefined;
  let timecodeScale = 1_000_000;

  while (offset < data.length) {
    // Need at least a few bytes for ID + size
    if (offset + 2 > data.length) return undefined;

    const elemId = readVintRaw(data, offset);
    const idEnd = offset + elemId.length;
    if (idEnd >= data.length) return undefined;

    const elemSize = readVintSize(data, idEnd);
    const bodyStart = idEnd + elemSize.length;
    const bodyEnd = bodyStart + elemSize.value;

    // Stop at first Cluster — we have all the header we need
    if (elemId.value === CLUSTER_ID) break;

    // Check we have the full element in the buffer
    if (bodyEnd > data.length) return undefined;

    if (elemId.value === INFO_ID) {
      infoBytes = data.slice(offset, bodyEnd);
      timecodeScale = parseTimecodeScale(data, bodyStart, bodyEnd);
    } else if (elemId.value === TRACKS_ID) {
      tracksBytes = data.slice(offset, bodyEnd);
    } else if (elemId.value === CUES_ID) {
      cuePoints = parseCues(data, bodyStart, bodyEnd, timecodeScale);
    }

    offset = bodyEnd;
  }

  if (!infoBytes || !tracksBytes || !cuePoints || cuePoints.length === 0) {
    return undefined;
  }

  return {
    ebmlHeaderBytes,
    segmentBodyOffset,
    infoBytes,
    tracksBytes,
    cuePoints,
    timecodeScale,
  };
}

function parseTimecodeScale(
  data: Uint8Array,
  start: number,
  end: number,
): number {
  let offset = start;
  while (offset < end) {
    const id = readVintRaw(data, offset);
    const sz = readVintSize(data, offset + id.length);
    const bodyStart = offset + id.length + sz.length;

    if (id.value === TIMECODE_SCALE_ID) {
      return readUint(data, bodyStart, sz.value);
    }
    offset = bodyStart + sz.value;
  }
  return 1_000_000;
}

function parseCues(
  data: Uint8Array,
  start: number,
  end: number,
  timecodeScale: number,
): CuePoint[] {
  const points: CuePoint[] = [];
  let offset = start;

  while (offset < end) {
    const id = readVintRaw(data, offset);
    const sz = readVintSize(data, offset + id.length);
    const bodyStart = offset + id.length + sz.length;
    const bodyEnd = bodyStart + sz.value;

    if (id.value === CUEPOINT_ID) {
      const point = parseCuePoint(data, bodyStart, bodyEnd, timecodeScale);
      if (point) points.push(point);
    }
    offset = bodyEnd;
  }

  return points;
}

function parseCuePoint(
  data: Uint8Array,
  start: number,
  end: number,
  timecodeScale: number,
): CuePoint | undefined {
  let timeRaw: number | undefined;
  let clusterPosition: number | undefined;
  let offset = start;

  while (offset < end) {
    const id = readVintRaw(data, offset);
    const sz = readVintSize(data, offset + id.length);
    const bodyStart = offset + id.length + sz.length;
    const bodyEnd = bodyStart + sz.value;

    if (id.value === CUETIME_ID) {
      timeRaw = readUint(data, bodyStart, sz.value);
    } else if (id.value === CUETRACKPOSITIONS_ID) {
      clusterPosition = parseCueClusterPosition(data, bodyStart, bodyEnd);
    }
    offset = bodyEnd;
  }

  if (timeRaw !== undefined && clusterPosition !== undefined) {
    // Convert raw ticks to milliseconds
    const timeMs = (timeRaw * timecodeScale) / 1_000_000;
    return { timeMs, clusterPosition };
  }
  return undefined;
}

function parseCueClusterPosition(
  data: Uint8Array,
  start: number,
  end: number,
): number | undefined {
  let offset = start;
  while (offset < end) {
    const id = readVintRaw(data, offset);
    const sz = readVintSize(data, offset + id.length);
    const bodyStart = offset + id.length + sz.length;

    if (id.value === CUECLUSTERPOSITION_ID) {
      return readUint(data, bodyStart, sz.value);
    }
    offset = bodyStart + sz.value;
  }
  return undefined;
}

// --- Byte-range computation ---

/**
 * Find the byte range (absolute file offsets) containing the requested time span.
 * Returns start (inclusive) and optional end (exclusive) byte offsets.
 * If end is undefined, download to end of file.
 */
export function findContainingRange(
  header: WebmHeader,
  startTimeMs: number,
  endTimeMs: number,
): { start: number; end?: number } {
  const { cuePoints, segmentBodyOffset } = header;

  // Find last cue point at or before startTime
  let startIdx = 0;
  for (let i = cuePoints.length - 1; i >= 0; i--) {
    if (cuePoints[i]!.timeMs <= startTimeMs) {
      startIdx = i;
      break;
    }
  }

  // Find first cue point after endTime (need one extra cluster for safety)
  let endIdx: number | undefined;
  for (let i = 0; i < cuePoints.length; i++) {
    if (cuePoints[i]!.timeMs > endTimeMs) {
      // Take one more cluster past that if available
      endIdx = Math.min(i + 1, cuePoints.length - 1);
      break;
    }
  }

  const start = segmentBodyOffset + cuePoints[startIdx]!.clusterPosition;
  const end =
    endIdx !== undefined
      ? segmentBodyOffset + cuePoints[endIdx]!.clusterPosition
      : undefined;

  return { start, end };
}

// --- Remuxing ---

/**
 * Build a valid WebM file from header metadata + partial cluster data.
 * The result can be fed to mediabunny for OPUS conversion.
 */
export function remuxWebm(
  header: WebmHeader,
  clusterData: Uint8Array,
): Uint8Array {
  // Structure: EBML header + Segment(unknown-size) { Info, Tracks, ClusterData }
  const segmentId = encodeId(SEGMENT_ID);
  // EBML "unknown size" — 8-byte VINT with all data bits set
  const unknownSize = new Uint8Array([
    0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ]);

  const totalSize =
    header.ebmlHeaderBytes.length +
    segmentId.length +
    unknownSize.length +
    header.infoBytes.length +
    header.tracksBytes.length +
    clusterData.length;

  const result = new Uint8Array(totalSize);
  let offset = 0;

  result.set(header.ebmlHeaderBytes, offset);
  offset += header.ebmlHeaderBytes.length;

  result.set(segmentId, offset);
  offset += segmentId.length;

  result.set(unknownSize, offset);
  offset += unknownSize.length;

  result.set(header.infoBytes, offset);
  offset += header.infoBytes.length;

  result.set(header.tracksBytes, offset);
  offset += header.tracksBytes.length;

  result.set(clusterData, offset);

  return result;
}
