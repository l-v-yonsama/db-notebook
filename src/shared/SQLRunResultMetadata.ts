import type { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";

export type SQLRunResultMetadata = {
  tableName?: string;
  type?: string;
  rdh?: ResultSetData;
  explainRdh?: ResultSetData;
  analyzedRdh?: ResultSetData;
  [key: string]: any;
};
