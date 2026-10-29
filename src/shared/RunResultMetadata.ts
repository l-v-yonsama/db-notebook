import type { ResultSetData } from "@l-v-yonsama/rdh";
import type { Entry } from "har-format";

export type NodeRunAxiosEvent = {
  title: string;
  entry: Entry;
};

export type JSONCellValues = {
  cellIndex: number;
  replaceAll: boolean;
  data: {
    [key: string]: any;
  };
};

export type LMContent = {
  row: number;
  col: number;
  message: string;
  reference?: {
    title: string;
    url: string;
  };
};

export type LMResult = {
  model?: {
    id: string;
    vendor: string;
    family: string;
    version: string;
    name?: string;
  };
  contents: LMContent[];
  ok: boolean;
  markdownText: string;
  elapsedTime: number;
};

export type MqttPublishResult = {
  ok: boolean;
  message?: string;
  elapsedTime: number;
  payloadLength: number;
  subscription: string;
  messageId?: number;
};

export type ShellResult = {
  ok: boolean;
  message?: string;
  elapsedTime: number;
};

/** Display model for an RPC notebook response output. */
export type RpcNotebookResult = {
  version: 1;
  kind: "response";
  cellId: string;
  outcome: "running" | "success" | "error" | "cancelled" | "timeout";
  status?: { code: number; name: string };
  elapsedMs: number;
  sentCount?: number;
  receivedCount: number;
  contents?: unknown;
  messages?: Array<{ index: number; at: number; contents: unknown }>;
  headers?: Record<string, string[]>;
  trailers?: Record<string, string[]>;
  error?: string;
  droppedCount?: number;
};

export type RunResultMetadata = {
  tableName?: string;
  type?: string;
  rdh?: ResultSetData;
  explainRdh?: ResultSetData;
  analyzedRdh?: ResultSetData;
  axiosEvent?: NodeRunAxiosEvent;
  lmResult?: LMResult;
  mqttPublishResult?: MqttPublishResult;
  shellResult?: ShellResult;
  rpcResult?: RpcNotebookResult;
  updateJSONCellValues?: JSONCellValues[];
  [key: string]: any;
};
