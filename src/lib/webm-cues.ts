// Minimal EBML parser for extracting WebM cue points from header data.
// Used by fast-seek download to determine which byte ranges to fetch.

interface CuePoint {
  /** Timestamp in seconds */
  time: number;
  /** Absolute byte offset of the cluster in the original file */
  clusterPosition: number;
}

interface WebmHeaderInfo {
  /** Byte offset where the Segment body starts */
  segmentDataStart: number;
  /** Nanoseconds per timestamp tick (default 1_000_000 = 1ms) */
  timestampScale: number;
  /** Extracted cue points, sorted by time */
  cuePoints: CuePoint[];
  /** Byte offset where the first Cluster element starts (end of header) */
  firstClusterOffset: number;
  /** If Cues wasn't found inline, absolute position from SeekHead */
  cuesPosition?: number;
}

// EBML element IDs relevant to fast-seek
const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
} as const;

class BufferReader {
  pos: number;
  private view: DataView;

  constructor(
    private buffer: Uint8Array,
    startPos = 0,
  ) {
    this.pos = startPos;
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
  }

  get remaining(): number {
    return this.buffer.length - this.pos;
  }

  readU8(): number {
    return this.view.getUint8(this.pos++);
  }

  skip(n: number) {
    this.pos += n;
  }

  /** Read EBML element ID (unsigned int preserving VINT marker bit). */
  readElementId(): number | null {
    if (this.remaining < 1) return null;
    const firstByte = this.buffer[this.pos]!;
    if (firstByte === 0) return null;

    let width = 1;
    let mask = 0x80;
    while ((firstByte & mask) === 0) {
      width++;
      mask >>= 1;
    }

    if (this.remaining < width) return null;
    return this.readUnsignedInt(width);
  }

  /** Read EBML element size. Returns undefined for "unknown size". */
  readElementSize(): number | undefined | null {
    if (this.remaining < 1) return null;
    const firstByte = this.buffer[this.pos]!;
    if (firstByte === 0xff) {
      this.pos++;
      return undefined;
    }
    return this.readVarInt();
  }

  /** Read element header (ID + size). */
  readElementHeader(): { id: number; size: number | undefined } | null {
    const id = this.readElementId();
    if (id === null) return null;
    const size = this.readElementSize();
    if (size === null) return null;
    return { id, size };
  }

  /** Read EBML variable-length integer. */
  readVarInt(): number | null {
    if (this.remaining < 1) return null;
    const firstByte = this.readU8();
    if (firstByte === 0) return null;

    let width = 1;
    let mask = 1 << 7;
    while ((firstByte & mask) === 0) {
      width++;
      mask >>= 1;
    }

    if (this.remaining < width - 1) return null;

    let value = firstByte & (mask - 1);
    for (let i = 1; i < width; i++) {
      value = value * 256 + this.readU8();
    }
    return value;
  }

  /** Read unsigned integer of given byte width. */
  readUnsignedInt(width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) {
      value = value * 256 + this.readU8();
    }
    return value;
  }
}

/**
 * Parse WebM header from a buffer to extract cue points.
 * The buffer should contain at least the header portion of the WebM file
 * (everything before the first Cluster element).
 */
export function parseWebmHeader(buffer: Uint8Array): WebmHeaderInfo {
  const reader = new BufferReader(buffer);

  // Read EBML header
  const ebmlHeader = reader.readElementHeader();
  if (!ebmlHeader || ebmlHeader.id !== ID.EBML) {
    throw new Error("Not a valid EBML file");
  }
  if (ebmlHeader.size !== undefined) {
    reader.skip(ebmlHeader.size);
  }

  // Read Segment header
  const segmentHeader = reader.readElementHeader();
  if (!segmentHeader || segmentHeader.id !== ID.Segment) {
    throw new Error("Segment element not found");
  }
  const segmentDataStart = reader.pos;

  // Iterate Level-1 elements to find SeekHead, Info, Cues
  let timestampScale = 1_000_000;
  let cuePoints: CuePoint[] = [];
  let firstClusterOffset = -1;
  let cuesPosition: number | undefined;
  const seekEntries: { id: number; position: number }[] = [];

  while (reader.remaining > 0) {
    const elementStart = reader.pos;
    const header = reader.readElementHeader();
    if (!header) break;

    const dataStart = reader.pos;

    if (header.id === ID.Cluster) {
      firstClusterOffset = elementStart;
      break;
    }

    if (header.id === ID.SeekHead && header.size !== undefined) {
      parseSeekHead(reader, dataStart, header.size, seekEntries);
    } else if (header.id === ID.Info && header.size !== undefined) {
      timestampScale = parseInfo(reader, dataStart, header.size);
    } else if (header.id === ID.Cues && header.size !== undefined) {
      cuePoints = parseCuesChildren(
        reader,
        dataStart,
        header.size,
        segmentDataStart,
        timestampScale,
      );
    }

    if (header.size !== undefined) {
      reader.pos = dataStart + header.size;
    } else {
      break;
    }
  }

  // If Cues wasn't found inline, check SeekHead
  if (cuePoints.length === 0) {
    const cuesEntry = seekEntries.find((e) => e.id === ID.Cues);
    if (cuesEntry) {
      const absPos = segmentDataStart + cuesEntry.position;
      if (absPos < buffer.length) {
        // Cues is within our buffer — parse it
        const cuesReader = new BufferReader(buffer, absPos);
        const header = cuesReader.readElementHeader();
        if (header?.id === ID.Cues && header.size !== undefined) {
          cuePoints = parseCuesChildren(
            cuesReader,
            cuesReader.pos,
            header.size,
            segmentDataStart,
            timestampScale,
          );
        }
      } else {
        // Cues is beyond our buffer — caller needs to fetch it
        cuesPosition = absPos;
      }
    }
  }

  // Determine first cluster offset from cue points or SeekHead
  if (firstClusterOffset === -1 && cuePoints.length > 0) {
    firstClusterOffset = cuePoints[0]!.clusterPosition;
  }
  if (firstClusterOffset === -1) {
    const clusterEntry = seekEntries.find((e) => e.id === ID.Cluster);
    if (clusterEntry) {
      firstClusterOffset = segmentDataStart + clusterEntry.position;
    }
  }
  if (firstClusterOffset === -1) {
    throw new Error("Could not determine first Cluster position");
  }

  cuePoints.sort((a, b) => a.time - b.time);

  return {
    segmentDataStart,
    timestampScale,
    cuePoints,
    firstClusterOffset,
    cuesPosition,
  };
}

/**
 * Parse a Cues element from a standalone buffer.
 * Used when Cues is at the end of the file and must be fetched separately.
 */
export function parseCuesElement(
  buffer: Uint8Array,
  segmentDataStart: number,
  timestampScale: number,
): CuePoint[] {
  const reader = new BufferReader(buffer);
  const header = reader.readElementHeader();
  if (!header || header.id !== ID.Cues || header.size === undefined) return [];
  const cues = parseCuesChildren(
    reader,
    reader.pos,
    header.size,
    segmentDataStart,
    timestampScale,
  );
  cues.sort((a, b) => a.time - b.time);
  return cues;
}

/**
 * Find the byte range of clusters containing the requested time span.
 * Uses binary search on cue points to find the minimal download range.
 */
export function findContainingRange(
  info: WebmHeaderInfo,
  startTime: number,
  endTime: number,
): { start: number; end?: number } {
  const { cuePoints } = info;

  if (cuePoints.length === 0) {
    return { start: info.firstClusterOffset };
  }

  // Last cue point with time <= startTime
  let startIdx = 0;
  let lo = 0;
  let hi = cuePoints.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (cuePoints[mid]!.time <= startTime) {
      startIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // First cue point with time > endTime (exclusive boundary)
  let endIdx: number | undefined;
  lo = 0;
  hi = cuePoints.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (cuePoints[mid]!.time > endTime) {
      endIdx = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return {
    start: cuePoints[startIdx]!.clusterPosition,
    end: endIdx !== undefined ? cuePoints[endIdx]!.clusterPosition : undefined,
  };
}

// --- Internal parsers ---

function parseSeekHead(
  reader: BufferReader,
  dataStart: number,
  size: number,
  seekEntries: { id: number; position: number }[],
) {
  const end = dataStart + size;
  reader.pos = dataStart;

  while (reader.pos < end && reader.remaining > 0) {
    const header = reader.readElementHeader();
    if (!header) break;
    const childStart = reader.pos;

    if (header.id === ID.Seek && header.size !== undefined) {
      let seekId: number | undefined;
      let seekPosition: number | undefined;
      const seekEnd = childStart + header.size;

      while (reader.pos < seekEnd && reader.remaining > 0) {
        const h = reader.readElementHeader();
        if (!h) break;
        if (h.id === ID.SeekID && h.size !== undefined) {
          seekId = reader.readUnsignedInt(h.size);
        } else if (h.id === ID.SeekPosition && h.size !== undefined) {
          seekPosition = reader.readUnsignedInt(h.size);
        } else if (h.size !== undefined) {
          reader.skip(h.size);
        }
      }

      if (seekId !== undefined && seekPosition !== undefined) {
        seekEntries.push({ id: seekId, position: seekPosition });
      }
      reader.pos = seekEnd;
    } else if (header.size !== undefined) {
      reader.skip(header.size);
    }
  }
}

function parseInfo(
  reader: BufferReader,
  dataStart: number,
  size: number,
): number {
  const end = dataStart + size;
  reader.pos = dataStart;
  let timestampScale = 1_000_000;

  while (reader.pos < end && reader.remaining > 0) {
    const header = reader.readElementHeader();
    if (!header) break;
    if (header.id === ID.TimestampScale && header.size !== undefined) {
      timestampScale = reader.readUnsignedInt(header.size);
    } else if (header.size !== undefined) {
      reader.skip(header.size);
    }
  }

  return timestampScale;
}

function parseCuesChildren(
  reader: BufferReader,
  dataStart: number,
  size: number,
  segmentDataStart: number,
  timestampScale: number,
): CuePoint[] {
  const end = dataStart + size;
  reader.pos = dataStart;
  const cuePoints: CuePoint[] = [];

  while (reader.pos < end && reader.remaining > 0) {
    const header = reader.readElementHeader();
    if (!header) break;
    const childStart = reader.pos;

    if (header.id === ID.CuePoint && header.size !== undefined) {
      const cueEnd = childStart + header.size;
      let cueTime: number | undefined;
      let clusterPosition: number | undefined;

      while (reader.pos < cueEnd && reader.remaining > 0) {
        const h = reader.readElementHeader();
        if (!h) break;
        const hStart = reader.pos;

        if (h.id === ID.CueTime && h.size !== undefined) {
          const rawTime = reader.readUnsignedInt(h.size);
          cueTime = (rawTime * timestampScale) / 1_000_000_000;
        } else if (h.id === ID.CueTrackPositions && h.size !== undefined) {
          const tpEnd = hStart + h.size;
          while (reader.pos < tpEnd && reader.remaining > 0) {
            const th = reader.readElementHeader();
            if (!th) break;
            if (th.id === ID.CueClusterPosition && th.size !== undefined) {
              clusterPosition =
                segmentDataStart + reader.readUnsignedInt(th.size);
            } else if (th.size !== undefined) {
              reader.skip(th.size);
            }
          }
          reader.pos = tpEnd;
        } else if (h.size !== undefined) {
          reader.skip(h.size);
        }
      }

      if (cueTime !== undefined && clusterPosition !== undefined) {
        cuePoints.push({ time: cueTime, clusterPosition });
      }
      reader.pos = cueEnd;
    } else if (header.size !== undefined) {
      reader.skip(header.size);
    }
  }

  return cuePoints;
}
