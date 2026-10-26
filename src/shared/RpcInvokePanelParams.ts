import type {
  RpcStatus,
  RpcStreamCompletion,
  RpcStreamEvent,
  RpcStreamKind,
} from "@l-v-yonsama/multi-platform-database-drivers";

export type RpcInvokeTarget = {
  connectionName: string;
  service: string;
  method: string;
  path: string;
  inputType: string;
  outputType: string;
  discovery: "declared" | "advertised";
  requestStream: boolean;
  responseStream: boolean;
  requestTemplate: string;
  requestDescription: string;
  responseDescription: string;
  requestDescriptionHtml: string;
  responseDescriptionHtml: string;
};

export type RpcInvokeRequest = {
  connectionName: string;
  service: string;
  method: string;
  requestJson: string;
  metadata?: Record<string, string | string[]>;
};

export type RpcInvokeResultView = {
  status: RpcStatus;
  elapsedMs: number;
  contentsHtml: string;
  headersHtml?: string;
  trailersHtml?: string;
};

export type RpcStreamAction = { sessionId: string };
export type RpcStreamSendAction = RpcStreamAction & { requestJson: string };

export type RpcStreamStartedView = { sessionId: string; kind: RpcStreamKind };
export type RpcStreamConnectingView = { sessionId: string };
export type RpcStreamEventView = RpcStreamAction & {
  sequence: number;
  event: RpcStreamEvent;
};
export type RpcStreamCompletedView = RpcStreamAction & {
  completion: RpcStreamCompletion & { cleanupError?: string };
};
export type RpcStreamErrorView = { sessionId?: string; error: string };
