import type { RpcResponse } from "./lib/rpc.ts";
import type { RpcClient } from "./lib/rpc.ts";
import { createRpcProxy } from "./lib/rpc.ts";
import type { workerRpcHandlers } from "./worker.ts";
import ConvertWorker from "./worker.ts?worker";

type WorkerRpc = RpcClient<typeof workerRpcHandlers>;

let workerRpc: WorkerRpc | undefined;

export function getWorkerRpc(): WorkerRpc {
  if (!workerRpc) {
    const worker = new ConvertWorker();

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

    workerRpc = createRpcProxy<typeof workerRpcHandlers>(call);
  }
  return workerRpc;
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
