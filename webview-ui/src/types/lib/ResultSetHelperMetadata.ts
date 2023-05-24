import type { CompareKey } from "./CompareKey";

export type RdhMeta = {
  connectionName?: string;
  tableName?: string;
  comment?: string;
  compareKeys?: CompareKey[];
  type?: string;
  [key: string]: any;
};
