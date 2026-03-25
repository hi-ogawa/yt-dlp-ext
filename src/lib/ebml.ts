// EBML variable-length integer and element parsing for WebM.
// Reference: https://www.matroska.org/technical/elements.html

// --- Known element IDs ---

export const EBML_ID = 0x1a45dfa3;
export const SEGMENT_ID = 0x18538067;
export const INFO_ID = 0x1549a966;
export const TRACKS_ID = 0x1654ae6b;
export const CUES_ID = 0x1c53bb6b;
export const CLUSTER_ID = 0x1f43b675;
export const CUEPOINT_ID = 0xbb;
export const CUETIME_ID = 0xb3;
export const CUETRACKPOSITIONS_ID = 0xb7;
export const CUECLUSTERPOSITION_ID = 0xf1;
export const TIMECODE_SCALE_ID = 0x2ad7b1;

// --- VINT reading ---

/** Read a raw VINT (variable-length integer) — marker bits kept (for element IDs). */
export function readVintRaw(
  data: Uint8Array,
  offset: number,
): { value: number; length: number } {
  const first = data[offset];
  if (first === undefined || first === 0)
    throw new Error(`Invalid VINT at offset ${offset}`);

  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && length < 8) {
    length++;
    mask >>= 1;
  }

  let value = first;
  for (let i = 1; i < length; i++) {
    value = value * 256 + data[offset + i]!;
  }

  return { value, length };
}

/** Read a VINT size — marker bit stripped (for element data sizes). */
export function readVintSize(
  data: Uint8Array,
  offset: number,
): { value: number; length: number } {
  const first = data[offset];
  if (first === undefined || first === 0)
    throw new Error(`Invalid VINT size at offset ${offset}`);

  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && length < 8) {
    length++;
    mask >>= 1;
  }

  // Strip marker bit
  let value = first & (mask - 1);
  for (let i = 1; i < length; i++) {
    value = value * 256 + data[offset + i]!;
  }

  return { value, length };
}

/** Read an unsigned integer from raw bytes. */
export function readUint(
  data: Uint8Array,
  offset: number,
  length: number,
): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = value * 256 + data[offset + i]!;
  }
  return value;
}

/** Encode an element ID as raw bytes. */
export function encodeId(id: number): Uint8Array {
  if (id <= 0xff) return new Uint8Array([id]);
  if (id <= 0xffff) return new Uint8Array([id >> 8, id & 0xff]);
  if (id <= 0xffffff)
    return new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  return new Uint8Array([
    (id >> 24) & 0xff,
    (id >> 16) & 0xff,
    (id >> 8) & 0xff,
    id & 0xff,
  ]);
}
