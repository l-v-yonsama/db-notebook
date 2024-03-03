import type { RdhMeta, RdhSummary } from "@l-v-yonsama/multi-platform-database-drivers";

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
