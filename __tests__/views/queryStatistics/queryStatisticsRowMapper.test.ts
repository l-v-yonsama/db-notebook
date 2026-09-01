import { describe, expect, it } from "vitest";
import { mapStatementStatisticsRow } from "../../../src/views/queryStatistics/queryStatisticsRowMapper";

describe("mapStatementStatisticsRow", () => {
  it("maps a full row from getStatementStatistics()'s common 15 columns", () => {
    const result = mapStatementStatisticsRow({
      statement_id: "42",
      database_name: "app",
      query: "SELECT * FROM orders WHERE id = $1",
      execution_count: 10,
      total_elapsed_time_ms: 1234.5,
      average_elapsed_time_ms: 123.45,
      min_elapsed_time_ms: 10,
      max_elapsed_time_ms: 500,
      rows_processed: 10,
      rows_examined: 100,
      logical_reads: 200,
      physical_reads: 5,
      last_executed_at: "2026-08-17T00:00:00.000Z",
      statistics_since: "2026-08-01T00:00:00.000Z",
      source: "pg_stat_statements",
    });

    expect(result).toEqual({
      sql: "SELECT * FROM orders WHERE id = $1",
      statistics: {
        statementId: "42",
        executionCount: 10,
        totalElapsedTimeMs: 1234.5,
        averageElapsedTimeMs: 123.45,
        minElapsedTimeMs: 10,
        maxElapsedTimeMs: 500,
        rowsProcessed: 10,
        rowsExamined: 100,
        logicalReads: 200,
        physicalReads: 5,
        statisticsSince: "2026-08-01T00:00:00.000Z",
        lastExecutedAt: "2026-08-17T00:00:00.000Z",
        source: "pg_stat_statements",
      },
      planInput: {
        sql: "SELECT * FROM orders WHERE id = $1",
        normalizedSql: "SELECT * FROM orders WHERE id = $1",
      },
    });
  });

  it("maps MySQL's optional sample columns into planInput.representative*", () => {
    const result = mapStatementStatisticsRow({
      query: "SELECT * FROM orders WHERE id = ?",
      query_sample_text: "SELECT * FROM orders WHERE id = 42",
      query_sample_seen_at: "2026-08-17T00:00:00.000Z",
      query_sample_text_may_be_truncated: 0,
    });

    expect(result?.planInput).toEqual({
      sql: "SELECT * FROM orders WHERE id = ?",
      normalizedSql: "SELECT * FROM orders WHERE id = ?",
      representativeSql: "SELECT * FROM orders WHERE id = 42",
      representativeSqlSeenAt: "2026-08-17T00:00:00.000Z",
      representativeSqlSource: "MySQL performance_schema sample",
      representativeSqlMayBeTruncated: false,
    });
  });

  it("treats query_sample_text_may_be_truncated as a 0/1 number, not just a JS boolean", () => {
    const result = mapStatementStatisticsRow({
      query: "SELECT 1",
      query_sample_text: "SELECT 1",
      query_sample_text_may_be_truncated: 1,
    });
    expect(result?.planInput.representativeSqlMayBeTruncated).toBe(true);
  });

  it("leaves planInput.representative* undefined for Vendors without sample columns", () => {
    const result = mapStatementStatisticsRow({ query: "SELECT 1" });
    expect(result?.planInput.representativeSql).toBeUndefined();
    expect(result?.planInput.representativeSqlSeenAt).toBeUndefined();
    expect(result?.planInput.representativeSqlSource).toBeUndefined();
    expect(result?.planInput.representativeSqlMayBeTruncated).toBeUndefined();
  });

  it("returns undefined when the query column is missing, empty, or not a string", () => {
    expect(mapStatementStatisticsRow({ execution_count: 1 })).toBeUndefined();
    expect(mapStatementStatisticsRow({ query: "" })).toBeUndefined();
    expect(mapStatementStatisticsRow({ query: "   " })).toBeUndefined();
    expect(mapStatementStatisticsRow({ query: 12345 })).toBeUndefined();
    expect(mapStatementStatisticsRow(undefined)).toBeUndefined();
    expect(mapStatementStatisticsRow(null)).toBeUndefined();
  });

  it("leaves a missing/non-finite numeric column undefined instead of defaulting it to 0", () => {
    const result = mapStatementStatisticsRow({
      query: "SELECT 1",
      execution_count: null,
      rows_examined: undefined,
      logical_reads: "not-a-number",
      physical_reads: NaN,
    });

    expect(result?.statistics.executionCount).toBeUndefined();
    expect(result?.statistics.rowsExamined).toBeUndefined();
    expect(result?.statistics.logicalReads).toBeUndefined();
    expect(result?.statistics.physicalReads).toBeUndefined();
  });

  it("keeps a real 0 distinguishable from a missing column", () => {
    const result = mapStatementStatisticsRow({ query: "SELECT 1", execution_count: 0 });
    expect(result?.statistics.executionCount).toBe(0);
  });

  it("accepts numeric strings", () => {
    const result = mapStatementStatisticsRow({ query: "SELECT 1", execution_count: "7" });
    expect(result?.statistics.executionCount).toBe(7);
  });

  it("accepts a safe-integer bigint", () => {
    const result = mapStatementStatisticsRow({ query: "SELECT 1", rows_processed: 42n });
    expect(result?.statistics.rowsProcessed).toBe(42);
  });

  it("leaves an unparseable date column undefined rather than 'Invalid Date'", () => {
    const result = mapStatementStatisticsRow({
      query: "SELECT 1",
      last_executed_at: "not-a-date",
      statistics_since: "",
    });
    expect(result?.statistics.lastExecutedAt).toBeUndefined();
    expect(result?.statistics.statisticsSince).toBeUndefined();
  });

  it("leaves statement_id/source undefined when the Vendor doesn't report them", () => {
    const result = mapStatementStatisticsRow({ query: "SELECT 1" });
    expect(result?.statistics.statementId).toBeUndefined();
    expect(result?.statistics.source).toBeUndefined();
  });
});
