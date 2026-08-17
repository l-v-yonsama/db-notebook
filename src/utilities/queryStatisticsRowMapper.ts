import type { SelectedStatementStatistics } from "@l-v-yonsama/multi-platform-database-drivers";

// Converts one row's values from getStatementStatistics()'s common 15-column
// RDH into the { sql, statistics } snapshot getPerformanceTuningContext()
// needs, without any Vendor-specific branching in the UI
// (misc/design/performance-tuning-context-implementation-plan.ja.md §10 Phase 5
// "行選択とworkload変換"). A pure function so it stays unit-testable outside
// of ToolsViewProvider's VS Code-coupled state.
//
// Deliberately conservative: a numeric column that's missing/non-finite
// stays `undefined` (never coerced to 0 - a real 0 execution count and "this
// Vendor doesn't report this column" must stay distinguishable), and a
// non-parseable date column stays `undefined` rather than becoming
// "Invalid Date". `statement_id`/`source` are optional per §10 Phase 5
// ("Vendorが返さない項目はundefinedのままにする").
export function mapStatementStatisticsRow(
  values: { [key: string]: any } | undefined | null
): { sql: string; statistics: SelectedStatementStatistics } | undefined {
  if (!values) {
    return undefined;
  }

  const sql = values["query"];
  if (typeof sql !== "string" || sql.trim() === "") {
    return undefined;
  }

  const statistics: SelectedStatementStatistics = {
    statementId: toNonEmptyString(values["statement_id"]),
    executionCount: toFiniteNumber(values["execution_count"]),
    totalElapsedTimeMs: toFiniteNumber(values["total_elapsed_time_ms"]),
    averageElapsedTimeMs: toFiniteNumber(values["average_elapsed_time_ms"]),
    minElapsedTimeMs: toFiniteNumber(values["min_elapsed_time_ms"]),
    maxElapsedTimeMs: toFiniteNumber(values["max_elapsed_time_ms"]),
    rowsProcessed: toFiniteNumber(values["rows_processed"]),
    rowsExamined: toFiniteNumber(values["rows_examined"]),
    logicalReads: toFiniteNumber(values["logical_reads"]),
    physicalReads: toFiniteNumber(values["physical_reads"]),
    statisticsSince: toIsoDateString(values["statistics_since"]),
    lastExecutedAt: toIsoDateString(values["last_executed_at"]),
    source: toNonEmptyString(values["source"]),
  };

  return { sql, statistics };
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  // bigint (some drivers may return counters as bigint) - safe as long as it
  // fits in a double; an out-of-range bigint is not silently truncated.
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

function toNonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function toIsoDateString(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") {
    return undefined;
  }
  const d = v instanceof Date ? v : new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
