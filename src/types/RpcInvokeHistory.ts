import type { RpcCallKind } from "@l-v-yonsama/multi-platform-database-drivers";

export type RpcInvokeHistory = {
  id: string;
  connectionName: string;
  service: string;
  method: string;
  path: string;
  callKind: RpcCallKind;
  invokedAt: number;
  totalElapsedMs: number;
  sentCount: number;
  receivedCount: number;
  outcome: "success" | "error" | "cancelled" | "timeout";
  grpcStatus?: { code: number; name: string };
  // Only unary/server-streaming requests within the storage size limit are restorable.
  requestJson?: string;
};
