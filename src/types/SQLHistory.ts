import type { RdhMeta, RdhSummary } from "@l-v-yonsama/rdh";

// Duration stats accumulated across repeated executions of the same SQL
// (same trimmed sqlDoc + connectionName). Only executions with a measurable
// summary.elapsedTimeMilli contribute to these aggregates.
export type SQLHistoryPerformance = {
  sampleCount: number;
  totalElapsedTimeMilli: number;
  maxElapsedTimeMilli: number;
  lastElapsedTimeMilli: number;
};

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
  executedAt?: number;
  status?: "success" | "error";
  errorMessage?: string;
  lastErrorMessage?: string;
  lastErrorAt?: number;
  performance?: SQLHistoryPerformance;
};
