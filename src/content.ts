// Content script — MAIN world, all_frames: true.
// Injected into YouTube embed iframe inside the extension page.
// Handles postMessage RPC: fetchPlayerApi + chunked download.

import type { PlayerApiResult, YouTubeStreamingFormat } from "./lib/youtube.ts";
import { fetchPlayerApi } from "./lib/youtube.ts";

declare const __BUILD_TIME__: string;
declare const __GIT_REV__: string;
console.log(`[yt-dlp-ext] build: ${__BUILD_TIME__} (${__GIT_REV__})`);

// --- RPC types ---

interface RpcRequest {
  type: "ytdl-request";
  id: string;
  method: string;
  params: unknown;
}

interface RpcResponse {
  type: "ytdl-response";
  id: string;
  result?: unknown;
  error?: string;
}

// --- RPC handlers ---

async function getStreamingFormats(params: {
  videoId: string;
}): Promise<PlayerApiResult> {
  return await fetchPlayerApi(params.videoId);
}

async function downloadFormat(params: {
  videoId: string;
  itag: number;
}): Promise<{ data: ArrayBuffer; filename: string; size: number }> {
  const result = await fetchPlayerApi(params.videoId);
  const format = result.streamingFormats.find(
    (f: YouTubeStreamingFormat) => f.itag === params.itag,
  );
  if (!format) throw new Error(`Format itag ${params.itag} not found`);
  const filesize = format.contentLength;
  if (!filesize) throw new Error("Unknown file size");

  const CHUNK_SIZE = 5_000_000;
  const numChunks = Math.ceil(filesize / CHUNK_SIZE);
  const data = new Uint8Array(filesize);
  let offset = 0;

  for (let i = 0; i < numChunks; i++) {
    const start = CHUNK_SIZE * i;
    const end = Math.min(CHUNK_SIZE * (i + 1), filesize);
    const res = await fetch(format.url, {
      headers: { range: `bytes=${start}-${end - 1}` },
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

  const ext = format.mimeType.split(";")[0]?.split("/")[1] ?? "webm";
  const filename = `${result.video.title}.${ext}`;

  // Transfer the ArrayBuffer back (zero-copy)
  return { data: data.buffer as ArrayBuffer, filename, size: filesize };
}

const handlers: Record<string, (params: never) => Promise<unknown>> = {
  getStreamingFormats,
  downloadFormat,
};

// --- postMessage listener ---

window.addEventListener("message", async (e: MessageEvent) => {
  const msg = e.data as RpcRequest;
  if (msg?.type !== "ytdl-request") return;

  const { id, method, params } = msg;
  const handler = handlers[method];
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
