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

export interface ConvertRequest {
  type: "convert";
  webmData: ArrayBuffer;
  metadata: MetadataTags;
}

export interface ConvertResponse {
  type: "convert-result";
  opusData?: ArrayBuffer;
  error?: string;
}

self.addEventListener("message", async (e: MessageEvent<ConvertRequest>) => {
  if (e.data.type !== "convert") return;

  try {
    const input = new Input({
      source: new BlobSource(new Blob([e.data.webmData])),
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
      tags: e.data.metadata,
    });
    await conversion.execute();

    const response: ConvertResponse = {
      type: "convert-result",
      opusData: target.buffer!,
    };
    self.postMessage(response, { transfer: [target.buffer!] });
  } catch (err) {
    const response: ConvertResponse = {
      type: "convert-result",
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
});
