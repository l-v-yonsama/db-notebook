import type { RdhMeta, RdhSummary } from "@l-v-yonsama/rdh";

// Duration stats accumulated across repeated executions of the same SQL
// (same trimmed sqlDoc + connectionName). Only executions with a measurable
// summary.elapsedTimeMilli contribute to these aggregates.
export type SQLHistoryPerformance = {
  sampleCount: number;
  totalElapsedTimeMilli: number;
  maxElapsedTimeMilli: number;
  lastElapsedTimeMilli: number;
  // Additive Capacity aggregates, folded in from summary.capacityUnits the
  // same way as the elapsed-time fields above - only ever populated when at
  // least one execution actually reported a capacityUnits value (DynamoDB
  // today), never defaulted to 0 for vendors that don't report it. Field
  // names mirror db-drivers' DynamoDbWorkloadContext
  // (totalCapacityUnits/maxCapacityUnits/lastCapacityUnits/
  // capacitySampleCount) so the two stay easy to line up when a DynamoDB
  // Preview merges SQL History workload into its Context.
  capacitySampleCount?: number;
  totalCapacityUnits?: number;
  maxCapacityUnits?: number;
  lastCapacityUnits?: number;
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
