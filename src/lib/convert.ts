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

export async function convertWebmToOpus(
  webmData: ArrayBuffer,
  metadata: MetadataTags,
): Promise<ArrayBuffer> {
  const input = new Input({
    source: new BlobSource(new Blob([webmData])),
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
    tags: metadata,
  });
  await conversion.execute();

  return target.buffer!;
}
