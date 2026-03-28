import {
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  OggOutputFormat,
  Output,
  WEBM,
} from "mediabunny";
import type { MetadataTags } from "mediabunny";
import type { RpcRequest, RpcResponse } from "./lib/rpc.ts";

export const workerRpcHandlers = {
  async convertWebmToOpus(params: {
    webmData: ArrayBuffer;
    metadata: MetadataTags;
    trim?: { start?: number; end?: number };
  }) {
    const input = new Input({
      source: new BlobSource(new Blob([params.webmData])),
      formats: [WEBM],
    });

    const target = new BufferTarget();
    const output = new Output({
      target,
      format: new OggOutputFormat(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      tags: params.metadata,
      trim: params.trim,
    });
    await conversion.execute();

    return target.buffer!;
  },
};

self.addEventListener("message", async (e: MessageEvent) => {
  const msg = e.data as RpcRequest;
  if (msg?.type !== "ytdl-request") return;

  const { id, method, params } = msg;
  const handler = workerRpcHandlers[method as keyof typeof workerRpcHandlers];
  if (!handler) {
    const response: RpcResponse = {
      type: "ytdl-response",
      id,
      error: `Unknown method: ${method}`,
    };
    self.postMessage(response);
    return;
  }

  try {
    const result = await handler(params as never);
    const response: RpcResponse = { type: "ytdl-response", id, result };
    const transferables: Transferable[] = [];
    if (result instanceof ArrayBuffer) {
      transferables.push(result);
    }
    self.postMessage(response, { transfer: transferables });
  } catch (err) {
    const response: RpcResponse = {
      type: "ytdl-response",
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
});

self.postMessage({ type: "ytdl-ready" });
