import type { SelectedStatementStatistics } from "@l-v-yonsama/multi-platform-database-drivers";
import type { QueryStatisticsPlanInput } from "./queryStatisticsPlanSql";

export type MappedStatementStatisticsRow = {
  sql: string;
  statistics: SelectedStatementStatistics;
  // Feeds selectPlanSql(); representative SQL is optional vendor evidence.
  planInput: QueryStatisticsPlanInput;
};

// Converts one statistics row into the stable snapshot used by plan selection
// and context collection, without vendor-specific UI branching.
//
// Deliberately conservative: a numeric column that's missing/non-finite
// stays `undefined` (never coerced to 0 - a real 0 execution count and "this
// Vendor doesn't report this column" must stay distinguishable), and a
// non-parseable date column stays `undefined` rather than becoming
// "Invalid Date". Vendor-specific optional values also remain undefined.
export function mapStatementStatisticsRow(
  values: { [key: string]: any } | undefined | null
): MappedStatementStatisticsRow | undefined {
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

  const representativeSql = toNonEmptyString(values["query_sample_text"]);
  const planInput: QueryStatisticsPlanInput = {
    sql,
    normalizedSql: sql,
    representativeSql,
    representativeSqlSeenAt: toIsoDateString(values["query_sample_seen_at"]),
    // A constant label, not a DB column: MySQL is the only Vendor with a
    // distinct "representative sample" concept today, so this is only ever
    // set alongside representativeSql itself (§3.1: "Representative query").
    representativeSqlSource: representativeSql ? "MySQL performance_schema sample" : undefined,
    representativeSqlMayBeTruncated: toOptionalBoolean(values["query_sample_text_may_be_truncated"]),
  };

  return { sql, statistics, planInput };
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

// query_sample_text_may_be_truncated is a computed boolean SQL expression
// (`LENGTH(...) >= @@GLOBAL...`), which mysql2 returns as a plain 0/1
// number rather than a JS boolean - not something the shared toBoolean()
// helper accepts, so this covers number/boolean/Buffer/string itself.
function toOptionalBoolean(v: unknown): boolean | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  if (typeof v === "boolean") {
    return v;
  }
  if (typeof v === "number") {
    return v !== 0;
  }
  if (Buffer.isBuffer(v)) {
    return v.at(0) === 1;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") {
      return undefined;
    }
    return trimmed === "1" || trimmed.toLowerCase() === "true";
  }
  return undefined;
}
