import type { ResultSetData, ContentTypeInfo } from "@l-v-yonsama/multi-platform-database-drivers";
import type { AxiosRequestConfig, AxiosResponse } from "axios";

export type NodeRunAxiosResponse = {
  title: string;
  headers: AxiosResponse["headers"];
  data: any;
  status: AxiosResponse["status"];
  statusText: AxiosResponse["statusText"];
  // milli sec
  elapsedTime?: number;
  contentTypeInfo: ContentTypeInfo;
  config: Partial<AxiosRequestConfig>;
};

export type RunResultMetadata = {
  tableName?: string;
  type?: string;
  rdh?: ResultSetData;
  explainRdh?: ResultSetData;
  analyzedRdh?: ResultSetData;
  res?: NodeRunAxiosResponse;
  [key: string]: any;
};
