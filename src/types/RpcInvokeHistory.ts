export type RpcInvokeHistory = {
  id: string;
  connectionName: string;
  service: string;
  method: string;
  path: string;
  callKind: "unary" | "serverStreaming" | "clientStreaming" | "bidiStreaming";
  invokedAt: number;
  totalElapsedMs: number;
  sentCount: number;
  receivedCount: number;
  outcome: "success" | "error" | "cancelled" | "timeout";
  grpcStatus?: { code: number; name: string };
  // Only unary/server-streaming requests within the storage size limit are restorable.
  requestJson?: string;
};
