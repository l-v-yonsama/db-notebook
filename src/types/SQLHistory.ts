import type { RdhMeta, RdhSummary } from "@l-v-yonsama/rdh";

export type SQLHistory = {
  id: string;
  sqlDoc: string;
  variables?: {
    [key: string]: any;
  };
  meta?: RdhMeta;
  summary?: RdhSummary;
  // CellMeta
  connectionName: string;
  ruleFile?: string;
  codeResolverFile?: string;
};
