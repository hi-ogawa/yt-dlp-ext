import type { RpcClient, RpcResponse } from "./lib/rpc.ts";
import { createRpcProxy } from "./lib/rpc.ts";
import type { workerRpcHandlers } from "./worker.ts";
import ConvertWorker from "./worker.ts?worker";

type WorkerRpc = RpcClient<typeof workerRpcHandlers>;

let workerRpcPromise: Promise<WorkerRpc> | undefined;

export function initWorkerRpc(): Promise<WorkerRpc> {
  if (!workerRpcPromise) {
    workerRpcPromise = new Promise((resolve, reject) => {
      const worker = new ConvertWorker();

      worker.addEventListener("error", (e) => {
        reject(new Error(`Worker error: ${e.message}`));
      });

      function call(method: string, params: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
          const id = crypto.randomUUID();

          const handler = (e: MessageEvent) => {
            const msg = e.data as RpcResponse;
            if (msg?.type !== "ytdl-response" || msg.id !== id) return;
            worker.removeEventListener("message", handler);
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.result);
          };
          worker.addEventListener("message", handler);

          worker.postMessage(
            { type: "ytdl-request", id, method, params },
            { transfer: findTransferables(params) },
          );
        });
      }

      worker.addEventListener(
        "message",
        (e: MessageEvent) => {
          if (e.data?.type === "ytdl-ready") {
            resolve(createRpcProxy<typeof workerRpcHandlers>(call));
          }
        },
        { once: true },
      );
    });
  }
  return workerRpcPromise;
}

function findTransferables(value: unknown): Transferable[] {
  if (value == null || typeof value !== "object") return [];
  const transferables: Transferable[] = [];
  for (const v of Object.values(value)) {
    if (v instanceof ArrayBuffer) {
      transferables.push(v);
    }
  }
  return transferables;
}
