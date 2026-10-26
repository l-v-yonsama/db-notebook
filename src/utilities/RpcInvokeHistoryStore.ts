import { randomUUID } from "crypto";
import { Event, EventEmitter, Memento } from "vscode";
import { RpcInvokeHistory } from "../types/RpcInvokeHistory";

const STORAGE_KEY = "database-notebook-rpc-invoke-history";
const HISTORY_LIMIT = 50;
export const RPC_HISTORY_REQUEST_MAX_BYTES = 64 * 1024;

export const isRestorableRpcHistory = <T extends Pick<RpcInvokeHistory, "callKind" | "requestJson">>(
  history: T
): history is T & { requestJson: string } =>
  (history.callKind === "unary" || history.callKind === "serverStreaming") &&
  typeof history.requestJson === "string" &&
  Buffer.byteLength(history.requestJson, "utf8") <= RPC_HISTORY_REQUEST_MAX_BYTES;

export class RpcInvokeHistoryStore {
  private readonly changed = new EventEmitter<void>();
  readonly onDidChange: Event<void> = this.changed.event;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly globalState: Memento) {}

  async list(): Promise<RpcInvokeHistory[]> {
    await this.pending;
    return this.globalState.get<RpcInvokeHistory[]>(STORAGE_KEY, []);
  }

  add(value: Omit<RpcInvokeHistory, "id">): Promise<void> {
    return this.mutate(async () => {
      // Copy only the approved summary fields. Invocation bodies and metadata never enter storage.
      const entry: RpcInvokeHistory = {
        id: randomUUID(),
        connectionName: value.connectionName,
        service: value.service,
        method: value.method,
        path: value.path,
        callKind: value.callKind,
        invokedAt: value.invokedAt,
        totalElapsedMs: value.totalElapsedMs,
        sentCount: value.sentCount,
        receivedCount: value.receivedCount,
        outcome: value.outcome,
        ...(value.grpcStatus && {
          grpcStatus: { code: value.grpcStatus.code, name: value.grpcStatus.name },
        }),
        ...(
          isRestorableRpcHistory(value) &&
          { requestJson: value.requestJson }
        ),
      };
      const previous = this.globalState.get<RpcInvokeHistory[]>(STORAGE_KEY, []);
      await this.globalState.update(STORAGE_KEY, [entry, ...previous].slice(0, HISTORY_LIMIT));
      this.changed.fire();
    });
  }

  delete(id: string): Promise<void> {
    return this.mutate(async () => {
      const previous = this.globalState.get<RpcInvokeHistory[]>(STORAGE_KEY, []);
      await this.globalState.update(STORAGE_KEY, previous.filter((item) => item.id !== id));
      this.changed.fire();
    });
  }

  clear(): Promise<void> {
    return this.mutate(async () => {
      await this.globalState.update(STORAGE_KEY, []);
      this.changed.fire();
    });
  }

  private mutate(action: () => Promise<void>): Promise<void> {
    const task = this.pending.then(action);
    this.pending = task.catch(() => undefined);
    return task;
  }
}
