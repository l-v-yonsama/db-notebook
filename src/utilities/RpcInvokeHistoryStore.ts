import { randomUUID } from "crypto";
import { Event, EventEmitter, Memento } from "vscode";
import { RpcInvokeHistory } from "../types/RpcInvokeHistory";
import { RpcHistoryRequestCapture, RPC_HISTORY_REQUEST_MAX_BYTES } from "./RpcHistoryRequestCapture";

const STORAGE_KEY = "database-notebook-rpc-invoke-history-v3";
const HISTORY_LIMIT = 50;

export type RpcInvokeHistoryAttempt = Omit<
  RpcInvokeHistory,
  "id" | "executedAt" | "lastErrorAt" | "lastErrorOutcome" | "executionCount" | "requestDigest" | "requestJson"
> & {
  startedAt: number;
  requestCapture: RpcHistoryRequestCapture;
};

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

  add(value: RpcInvokeHistoryAttempt): Promise<void> {
    const executedAt = Date.now();
    return this.mutate(async () => {
      const request = value.requestCapture.finish();
      const entry: RpcInvokeHistory = {
        id: randomUUID(),
        connectionName: value.connectionName,
        service: value.service,
        method: value.method,
        path: value.path,
        callKind: value.callKind,
        executedAt,
        executionCount: 1,
        requestDigest: request.requestDigest,
        totalElapsedMs: value.totalElapsedMs,
        sentCount: value.sentCount,
        receivedCount: value.receivedCount,
        outcome: value.outcome,
        ...(value.grpcStatus && {
          grpcStatus: { code: value.grpcStatus.code, name: value.grpcStatus.name },
        }),
        ...(request.requestJson && { requestJson: request.requestJson }),
        ...(value.requestMetadata && Object.keys(value.requestMetadata).length > 0 && {
          requestMetadata: value.requestMetadata,
        }),
      };
      const previous = [...this.globalState.get<RpcInvokeHistory[]>(STORAGE_KEY, [])];
      const matchIndex = previous.findIndex((item) =>
        item.connectionName === entry.connectionName &&
        item.path === entry.path &&
        item.callKind === entry.callKind &&
        item.requestDigest === entry.requestDigest
      );
      if (matchIndex >= 0) {
        const match = previous.splice(matchIndex, 1)[0];
        entry.id = match.id;
        entry.executionCount = match.executionCount + 1;
        if (entry.outcome !== "success" && match.outcome === "success") {
          const failedOutcome = entry.outcome;
          entry.executedAt = match.executedAt;
          entry.outcome = match.outcome;
          entry.totalElapsedMs = match.totalElapsedMs;
          entry.sentCount = match.sentCount;
          entry.receivedCount = match.receivedCount;
          entry.grpcStatus = match.grpcStatus;
          if (match.requestJson !== undefined) {
            entry.requestJson = match.requestJson;
          } else {
            delete entry.requestJson;
          }
          if (match.requestMetadata !== undefined) {
            entry.requestMetadata = match.requestMetadata;
          } else {
            delete entry.requestMetadata;
          }
          entry.lastErrorAt = executedAt;
          entry.lastErrorOutcome = failedOutcome;
        }
      }
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
