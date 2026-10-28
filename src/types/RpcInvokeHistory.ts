import type { RpcCallKind } from "@l-v-yonsama/multi-platform-database-drivers";

export type RpcInvokeHistory = {
  id: string;
  connectionName: string;
  service: string;
  method: string;
  path: string;
  callKind: RpcCallKind;
  executedAt: number;
  lastErrorAt?: number;
  lastErrorOutcome?: "error" | "cancelled" | "timeout";
  executionCount: number;
  requestDigest: string;
  totalElapsedMs: number;
  sentCount: number;
  receivedCount: number;
  outcome: "success" | "error" | "cancelled" | "timeout";
  grpcStatus?: { code: number; name: string };
  // Saved for every call kind when the complete Data fits the storage limit.
  requestJson?: string;
  requestMetadata?: Record<string, string | string[]>;
};
