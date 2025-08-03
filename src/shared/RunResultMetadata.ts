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

export type RunResultMetadata = {
  tableName?: string;
  type?: string;
  rdh?: ResultSetData;
  explainRdh?: ResultSetData;
  analyzedRdh?: ResultSetData;
  axiosEvent?: NodeRunAxiosEvent;
  lmResult?: LMResult;
  mqttPublishResult?: MqttPublishResult;
  updateJSONCellValues?: JSONCellValues[];
  [key: string]: any;
};
