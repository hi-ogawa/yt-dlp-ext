import type { MetadataTags } from "mediabunny";
import type { ConvertRequest, ConvertResponse } from "./convert-worker.ts";
import ConvertWorker from "./convert-worker.ts?worker";

let worker: Worker | undefined;

function getWorker(): Worker {
  if (!worker) {
    worker = new ConvertWorker();
  }
  return worker;
}

export async function convertWebmToOpus(
  webmData: ArrayBuffer,
  metadata: MetadataTags,
): Promise<ArrayBuffer> {
  const w = getWorker();

  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<ConvertResponse>) => {
      if (e.data.type !== "convert-result") return;
      w.removeEventListener("message", handler);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.opusData!);
    };
    w.addEventListener("message", handler);

    const request: ConvertRequest = { type: "convert", webmData, metadata };
    w.postMessage(request, { transfer: [webmData] });
  });
}
