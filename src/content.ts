// Content script — MAIN world, all_frames: true.
// Injected into YouTube embed iframe inside the extension page.
// Handles postMessage RPC: fetchPlayerApi + chunked download.

import {
  HEADER_FETCH_SIZE,
  findContainingRange,
  parseWebmHeader,
  remuxWebm,
} from "./lib/fast-seek.ts";
import type { RpcRequest, RpcResponse } from "./lib/rpc.ts";
import type { YouTubeStreamingFormat } from "./lib/youtube.ts";
import { fetchPlayerApi } from "./lib/youtube.ts";

declare const __BUILD_TIME__: string;
declare const __GIT_REV__: string;
console.log(`[yt-dlp-ext] build: ${__BUILD_TIME__} (${__GIT_REV__})`);

// --- RPC handlers ---
// Exported for typeof only — content script is a separate bundle,
// so this import is type-only and doesn't pull in runtime code.

export const contentRpcHandlers = {
  async getStreamingFormats(params: { videoId: string }) {
    return await fetchPlayerApi(params.videoId);
  },

  async downloadFormat(params: { videoId: string; itag: number }) {
    const result = await fetchPlayerApi(params.videoId);
    const format = result.streamingFormats.find(
      (f: YouTubeStreamingFormat) => f.itag === params.itag,
    );
    if (!format) throw new Error(`Format itag ${params.itag} not found`);
    const filesize = format.contentLength;
    if (!filesize) throw new Error("Unknown file size");

    const data = await fetchRange(format.url, 0, filesize);

    const ext = format.mimeType.split(";")[0]?.split("/")[1] ?? "webm";
    const filename = `${result.video.title}.${ext}`;

    // Transfer the ArrayBuffer back (zero-copy)
    return { data: data.buffer as ArrayBuffer, filename, size: filesize };
  },

  async downloadFormatFastSeek(params: {
    videoId: string;
    itag: number;
    startTimeMs: number;
    endTimeMs: number;
  }) {
    const result = await fetchPlayerApi(params.videoId);
    const format = result.streamingFormats.find(
      (f: YouTubeStreamingFormat) => f.itag === params.itag,
    );
    if (!format) throw new Error(`Format itag ${params.itag} not found`);
    const filesize = format.contentLength;
    if (!filesize) throw new Error("Unknown file size");

    // 1. Fetch header
    const headerSize = Math.min(HEADER_FETCH_SIZE, filesize);
    const headerData = await fetchRange(format.url, 0, headerSize);

    // 2. Parse header to get cue points
    const header = parseWebmHeader(headerData);
    if (!header) {
      throw new Error(
        "Could not parse WebM header (Cues not found in initial fetch)",
      );
    }

    // 3. Compute byte range for the requested time span
    const range = findContainingRange(
      header,
      params.startTimeMs,
      params.endTimeMs,
    );

    // 4. Download only the needed clusters
    const clusterData = await fetchRange(
      format.url,
      range.start,
      range.end ?? filesize,
    );

    // 5. Remux into valid WebM
    const remuxed = remuxWebm(header, clusterData);

    const ext = format.mimeType.split(";")[0]?.split("/")[1] ?? "webm";
    const filename = `${result.video.title}.${ext}`;

    return {
      data: remuxed.buffer as ArrayBuffer,
      filename,
      size: remuxed.length,
      originalSize: filesize,
    };
  },

  async fetchThumbnail(params: { videoId: string }) {
    const res = await fetch(
      `https://i.ytimg.com/vi/${params.videoId}/hqdefault.jpg`,
    );
    if (!res.ok) throw new Error(`Thumbnail fetch failed: ${res.status}`);
    return await res.arrayBuffer();
  },
};

// --- Helpers ---

/** Fetch a byte range from a URL, returning the data as a Uint8Array. */
async function fetchRange(
  url: string,
  start: number,
  end: number,
): Promise<Uint8Array> {
  const CHUNK_SIZE = 5_000_000;
  const totalSize = end - start;
  const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
  const data = new Uint8Array(totalSize);
  let offset = 0;

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = start + CHUNK_SIZE * i;
    const chunkEnd = Math.min(start + CHUNK_SIZE * (i + 1), end);
    const res = await fetch(url, {
      headers: { range: `bytes=${chunkStart}-${chunkEnd - 1}` },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Download failed: ${res.status}`);
    }
    if (!res.body) throw new Error("No response body");
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      data.set(value, offset);
      offset += value.length;
    }
  }

  return data;
}

// --- postMessage listener ---

window.addEventListener("message", async (e: MessageEvent) => {
  const msg = e.data as RpcRequest;
  if (msg?.type !== "ytdl-request") return;

  const { id, method, params } = msg;
  const handler = contentRpcHandlers[method as keyof typeof contentRpcHandlers];
  if (!handler) {
    const response: RpcResponse = {
      type: "ytdl-response",
      id,
      error: `Unknown method: ${method}`,
    };
    window.parent.postMessage(response, "*");
    return;
  }

  try {
    const result = await handler(params as never);
    const response: RpcResponse = { type: "ytdl-response", id, result };
    // Transfer ArrayBuffers if present (zero-copy)
    const transferables: Transferable[] = [];
    if (result && typeof result === "object" && "data" in result) {
      const r = result as { data: unknown };
      if (r.data instanceof ArrayBuffer) {
        transferables.push(r.data);
      }
    }
    window.parent.postMessage(response, "*", transferables);
  } catch (err) {
    const response: RpcResponse = {
      type: "ytdl-response",
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    window.parent.postMessage(response, "*");
  }
});

// Signal readiness to the parent extension page
window.parent.postMessage({ type: "ytdl-ready" }, "*");
