import { describe, expect, it } from "vitest";
import type { SQLHistory } from "../../src/types/SQLHistory";
import {
  averageElapsedTimeMilli,
  containsExplainStatement,
  createInitialSQLHistoryPerformance,
  isSQLHistoryTarget,
  mergeSQLHistoryPerformance,
} from "../../src/utilities/sqlHistoryUtil";

const baseHistory = (overrides: Partial<SQLHistory> = {}): SQLHistory => ({
  id: "h1",
  sqlDoc: "select 1",
  connectionName: "conn1",
  ...overrides,
});

describe("createInitialSQLHistoryPerformance", () => {
  it("elapsedTimeMilliが与えられればsampleCount=1で初期化する", () => {
    expect(createInitialSQLHistoryPerformance(120)).toEqual({
      sampleCount: 1,
      totalElapsedTimeMilli: 120,
      maxElapsedTimeMilli: 120,
      lastElapsedTimeMilli: 120,
    });
  });

  it("elapsedTimeMilliがundefinedなら全て0で初期化する", () => {
    expect(createInitialSQLHistoryPerformance(undefined)).toEqual({
      sampleCount: 0,
      totalElapsedTimeMilli: 0,
      maxElapsedTimeMilli: 0,
      lastElapsedTimeMilli: 0,
    });
  });
});

describe("mergeSQLHistoryPerformance", () => {
  it("performanceもsummaryも無い旧エントリへ初回計測をマージするとsampleCount=1になる", () => {
    const previous = baseHistory();
    expect(mergeSQLHistoryPerformance(previous, 100)).toEqual({
      sampleCount: 1,
      totalElapsedTimeMilli: 100,
      maxElapsedTimeMilli: 100,
      lastElapsedTimeMilli: 100,
    });
  });

  it("performance未設定でもsummary.elapsedTimeMilliがあれば遅延移行してから加算する", () => {
    const previous = baseHistory({ summary: { elapsedTimeMilli: 80 } as any });
    expect(mergeSQLHistoryPerformance(previous, 120)).toEqual({
      sampleCount: 2,
      totalElapsedTimeMilli: 200,
      maxElapsedTimeMilli: 120,
      lastElapsedTimeMilli: 120,
    });
  });

  it("旧エラー履歴のsummary.elapsedTimeMilliは成功サンプルへ移行しない", () => {
    const previous = baseHistory({
      status: "error",
      summary: { elapsedTimeMilli: 80 } as any,
    });
    expect(mergeSQLHistoryPerformance(previous, undefined)).toEqual({
      sampleCount: 0,
      totalElapsedTimeMilli: 0,
      maxElapsedTimeMilli: 0,
      lastElapsedTimeMilli: 0,
    });
  });

  it("既にperformanceがある場合はそれを基準に加算する", () => {
    const previous = baseHistory({
      performance: {
        sampleCount: 3,
        totalElapsedTimeMilli: 300,
        maxElapsedTimeMilli: 150,
        lastElapsedTimeMilli: 90,
      },
    });
    expect(mergeSQLHistoryPerformance(previous, 200)).toEqual({
      sampleCount: 4,
      totalElapsedTimeMilli: 500,
      maxElapsedTimeMilli: 200,
      lastElapsedTimeMilli: 200,
    });
  });

  it("新しい計測値がundefined(エラー実行など)の場合は集計を変えない", () => {
    const previous = baseHistory({
      performance: {
        sampleCount: 2,
        totalElapsedTimeMilli: 200,
        maxElapsedTimeMilli: 120,
        lastElapsedTimeMilli: 80,
      },
    });
    expect(mergeSQLHistoryPerformance(previous, undefined)).toEqual(previous.performance);
  });
});

describe("averageElapsedTimeMilli", () => {
  it("sampleCountが0なら0を返す", () => {
    expect(
      averageElapsedTimeMilli({
        sampleCount: 0,
        totalElapsedTimeMilli: 0,
        maxElapsedTimeMilli: 0,
        lastElapsedTimeMilli: 0,
      })
    ).toBe(0);
  });

  it("sampleCountがあれば total / count を返す", () => {
    expect(
      averageElapsedTimeMilli({
        sampleCount: 4,
        totalElapsedTimeMilli: 400,
        maxElapsedTimeMilli: 150,
        lastElapsedTimeMilli: 90,
      })
    ).toBe(100);
  });
});

describe("SQL History target classification", () => {
  it.each([
    "EXPLAIN SELECT * FROM t",
    "-- comment\nEXPLAIN ANALYZE SELECT * FROM t",
    "/* comment */ EXPLAIN (FORMAT JSON) SELECT * FROM t",
    "SELECT 1; EXPLAIN SELECT * FROM t",
  ])("Explain statementを検出する: %s", (sql) => {
    expect(containsExplainStatement(sql)).toBe(true);
    expect(isSQLHistoryTarget({ sqlDoc: sql })).toBe(false);
  });

  it.each([
    "SELECT 'EXPLAIN SELECT 1'",
    "SELECT $$; EXPLAIN SELECT 1$$",
    "SELECT 1 /* ; EXPLAIN SELECT 2 */",
  ])("literal/comment内のEXPLAINを誤検出しない: %s", (sql) => {
    expect(containsExplainStatement(sql)).toBe(false);
    expect(isSQLHistoryTarget({ sqlDoc: sql })).toBe(true);
  });

  it("旧sqlModeとplan metadataでもExplain系を除外する", () => {
    expect(isSQLHistoryTarget({ sqlDoc: "select 1", sqlMode: "Explain" })).toBe(false);
    expect(isSQLHistoryTarget({ sqlDoc: "select 1", meta: { type: "analyze" } })).toBe(false);
  });
});
