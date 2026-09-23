import type { LogParseDiagnostics } from "@l-v-yonsama/multi-platform-database-drivers";
import type { ResultSetData } from "@l-v-yonsama/rdh";

export type LogParseConfigurationState = {
  hasConfig: boolean;
  hasSplitFields: boolean;
  canSplit: boolean;
  canParse: boolean;
  availableStage?: "split" | "classify" | "sqlExecution";
  splitError: string;
  parseError: string;
};

export type LogParseRunState = {
  status: "success" | "failed";
  sample?: boolean;
  stage: "split" | "classify" | "sqlExecution";
  logName: string;
  linesToParse: number;
  eventCount: number;
  sqlCount: number;
  error?: string;
  diagnostics?: LogParseDiagnostics;
};

export type LogParseSampleState = {
  result: LogParseRunState;
  preview?: ResultSetData;
  classifiedPreview?: ResultSetData;
};

export type LogParseWorkflowState = {
  rawPreview?: ResultSetData;
  configDirty?: boolean;
  linesToParse?: number;
  setup?: {
    sampleLinesToParse: number;
    split?: LogParseSampleState;
    sql?: LogParseSampleState;
  };
  revision: number;
  configuration: LogParseConfigurationState;
  previewStatus?: "idle" | "waiting" | "running" | "ready" | "failed" | "stale";
  previewError?: string;
  result?: LogParseRunState;
  appliedSplitPreset?: string;
  appliedSqlPreset?: string;
};

export function formatLogParseDiagnostics(diagnostics?: LogParseDiagnostics): string {
  if (!diagnostics) {
    return "Field extraction diagnostics are unavailable.";
  }
  const { unmatchedEventCount, unmatchedEventStartLines } = diagnostics;
  if (unmatchedEventCount === 0) {
    return "";
  }
  const truncated = unmatchedEventCount > unmatchedEventStartLines.length;
  const positions = truncated
    ? `First ${unmatchedEventStartLines.length} start lines`
    : "Start lines";
  return `${unmatchedEventCount} log event${
    unmatchedEventCount === 1 ? "" : "s"
  } did not match the field pattern. ${positions}: ${unmatchedEventStartLines.join(", ")}.`;
}

export function getLogParseNextAction(
  state: LogParseWorkflowState
): "select-config" | "select-split" | "edit-config" | "select-sql" | "parse" {
  const config = state.configuration;
  if (!config.hasConfig) {
    return "select-config";
  }
  if (!config.hasSplitFields && !config.splitError) {
    return "select-split";
  }
  if (!config.canSplit) {
    return "edit-config";
  }
  return config.canParse ? "parse" : "select-sql";
}
