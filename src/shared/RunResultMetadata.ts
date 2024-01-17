import type { ResultSetData, ContentTypeInfo } from "@l-v-yonsama/multi-platform-database-drivers";
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

export type RunResultMetadata = {
  tableName?: string;
  type?: string;
  rdh?: ResultSetData;
  explainRdh?: ResultSetData;
  analyzedRdh?: ResultSetData;
  axiosEvent?: NodeRunAxiosEvent;
  updateJSONCellValues?: JSONCellValues[];
  [key: string]: any;
};
