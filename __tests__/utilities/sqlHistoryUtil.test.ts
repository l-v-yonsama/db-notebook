import { describe, expect, it } from "vitest";
import type { SQLHistory } from "../../src/types/SQLHistory";
import {
  averageCapacityUnits,
  averageElapsedTimeMilli,
  containsExplainStatement,
  createInitialSQLHistoryPerformance,
  isSQLHistoryTarget,
  mergeSQLHistoryPerformance,
  migrateStoredSQLHistory,
  resetSQLHistoryPerformance,
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
    });
  });
});

describe("resetSQLHistoryPerformance", () => {
  it("starts an empty measurement epoch without fabricated min/max/last values", () => {
    expect(resetSQLHistoryPerformance(1234, true)).toEqual({
      sampleCount: 0,
      totalElapsedTimeMilli: 0,
      capacitySampleCount: 0,
      dynamoDb: {
        observationSampleCount: 0,
        evaluatedCountSampleCount: 0,
        totalReturnedItemCount: 0,
        totalEvaluatedItemCount: 0,
        boundedObservationCount: 0,
      },
      statisticsSince: 1234,
      resetAt: 1234,
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

describe("Capacity aggregation (DynamoDB)", () => {
  it("createInitialSQLHistoryPerformance: capacityUnitsが与えられればcapacitySampleCount=1で初期化する", () => {
    expect(createInitialSQLHistoryPerformance(120, 2.5)).toEqual({
      sampleCount: 1,
      totalElapsedTimeMilli: 120,
      maxElapsedTimeMilli: 120,
      lastElapsedTimeMilli: 120,
      capacitySampleCount: 1,
      totalCapacityUnits: 2.5,
      maxCapacityUnits: 2.5,
      lastCapacityUnits: 2.5,
    });
  });

  it("createInitialSQLHistoryPerformance: capacityUnitsが無ければcapacity系フィールドは含まれない(0埋めしない)", () => {
    const result = createInitialSQLHistoryPerformance(120);
    expect(result.capacitySampleCount).toBeUndefined();
    expect(result.totalCapacityUnits).toBeUndefined();
  });

  it("mergeSQLHistoryPerformance: capacityUnitsを繰り返しマージするとsum/max/lastが正しく更新される", () => {
    const previous = baseHistory({
      performance: {
        sampleCount: 1,
        totalElapsedTimeMilli: 100,
        maxElapsedTimeMilli: 100,
        lastElapsedTimeMilli: 100,
        capacitySampleCount: 1,
        totalCapacityUnits: 2,
        maxCapacityUnits: 2,
        lastCapacityUnits: 2,
      },
    });
    expect(mergeSQLHistoryPerformance(previous, 50, 5)).toEqual({
      sampleCount: 2,
      totalElapsedTimeMilli: 150,
      maxElapsedTimeMilli: 100,
      lastElapsedTimeMilli: 50,
      capacitySampleCount: 2,
      totalCapacityUnits: 7,
      maxCapacityUnits: 5,
      lastCapacityUnits: 5,
    });
  });

  it("mergeSQLHistoryPerformance: capacityUnitsがundefined(非AWSベンダー等)なら集計を変えない", () => {
    const previous = baseHistory({
      performance: {
        sampleCount: 1,
        totalElapsedTimeMilli: 100,
        maxElapsedTimeMilli: 100,
        lastElapsedTimeMilli: 100,
        capacitySampleCount: 1,
        totalCapacityUnits: 2,
        maxCapacityUnits: 2,
        lastCapacityUnits: 2,
      },
    });
    const result = mergeSQLHistoryPerformance(previous, 50);
    expect(result.capacitySampleCount).toBe(1);
    expect(result.totalCapacityUnits).toBe(2);
    expect(result.maxCapacityUnits).toBe(2);
    expect(result.lastCapacityUnits).toBe(2);
  });

  it("mergeSQLHistoryPerformance: capacityUnits=0は欠落扱いしない", () => {
    const previous = baseHistory();
    const result = mergeSQLHistoryPerformance(previous, 10, 0);
    expect(result.capacitySampleCount).toBe(1);
    expect(result.totalCapacityUnits).toBe(0);
    expect(result.lastCapacityUnits).toBe(0);
  });
});

describe("DynamoDB read-shape aggregation (performance.dynamoDb)", () => {
  it("createInitialSQLHistoryPerformance: with no dynamoDb arg, the result has no dynamoDb key at all", () => {
    const result = createInitialSQLHistoryPerformance(120, 2.5);
    expect(result).not.toHaveProperty("dynamoDb");
  });

  it("createInitialSQLHistoryPerformance: a native Query summary seeds observationSampleCount/evaluatedCountSampleCount", () => {
    const result = createInitialSQLHistoryPerformance(120, 2.5, {
      apiOperation: "Query",
      returnedItemCount: 5,
      evaluatedItemCount: 20,
      continuationTokenPresent: false,
    });
    expect(result.dynamoDb).toEqual({
      observationSampleCount: 1,
      evaluatedCountSampleCount: 1,
      totalReturnedItemCount: 5,
      totalEvaluatedItemCount: 20,
      lastReturnedItemCount: 5,
      lastEvaluatedItemCount: 20,
      minFilterPassRate: 0.25,
      maxFilterPassRate: 0.25,
      lastFilterPassRate: 0.25,
      boundedObservationCount: 0,
    });
  });

  it("a PartiQL summary (evaluatedItemCount undefined) counts observationSampleCount but not evaluatedCountSampleCount", () => {
    const result = createInitialSQLHistoryPerformance(120, undefined, {
      apiOperation: "ExecuteStatement",
      returnedItemCount: 3,
    });
    expect(result.dynamoDb).toEqual({
      observationSampleCount: 1,
      evaluatedCountSampleCount: 0,
      totalReturnedItemCount: 3,
      totalEvaluatedItemCount: 0,
      lastReturnedItemCount: 3,
      lastEvaluatedItemCount: undefined,
      minFilterPassRate: undefined,
      maxFilterPassRate: undefined,
      lastFilterPassRate: undefined,
      boundedObservationCount: 0,
    });
  });

  it("mergeSQLHistoryPerformance: sums returned/evaluated across repeated native Query samples and tracks min/max pass rate", () => {
    const previous = baseHistory({
      performance: {
        sampleCount: 1,
        totalElapsedTimeMilli: 100,
        maxElapsedTimeMilli: 100,
        lastElapsedTimeMilli: 100,
        dynamoDb: {
          observationSampleCount: 1,
          evaluatedCountSampleCount: 1,
          totalReturnedItemCount: 5,
          totalEvaluatedItemCount: 20,
          lastReturnedItemCount: 5,
          lastEvaluatedItemCount: 20,
          minFilterPassRate: 0.25,
          maxFilterPassRate: 0.25,
          lastFilterPassRate: 0.25,
          boundedObservationCount: 0,
        },
      },
    });
    const result = mergeSQLHistoryPerformance(previous, 50, undefined, {
      apiOperation: "Query",
      returnedItemCount: 90,
      evaluatedItemCount: 100,
      continuationTokenPresent: true,
    });
    expect(result.dynamoDb).toEqual({
      observationSampleCount: 2,
      evaluatedCountSampleCount: 2,
      totalReturnedItemCount: 95,
      totalEvaluatedItemCount: 120,
      lastReturnedItemCount: 90,
      lastEvaluatedItemCount: 100,
      minFilterPassRate: 0.25,
      maxFilterPassRate: 0.9,
      lastFilterPassRate: 0.9,
      boundedObservationCount: 1,
    });
  });

  it("mergeSQLHistoryPerformance: a failed retry with no summary leaves the DynamoDB aggregate untouched", () => {
    const previous = baseHistory({
      performance: {
        sampleCount: 1,
        totalElapsedTimeMilli: 100,
        maxElapsedTimeMilli: 100,
        lastElapsedTimeMilli: 100,
        dynamoDb: {
          observationSampleCount: 1,
          evaluatedCountSampleCount: 1,
          totalReturnedItemCount: 5,
          totalEvaluatedItemCount: 20,
          lastReturnedItemCount: 5,
          lastEvaluatedItemCount: 20,
          minFilterPassRate: 0.25,
          maxFilterPassRate: 0.25,
          lastFilterPassRate: 0.25,
          boundedObservationCount: 0,
        },
      },
    });
    const result = mergeSQLHistoryPerformance(previous, undefined, undefined, undefined);
    expect(result.dynamoDb).toEqual(previous.performance!.dynamoDb);
  });

  it("mergeSQLHistoryPerformance: a non-AWS history never gains a dynamoDb key", () => {
    const previous = baseHistory({
      performance: {
        sampleCount: 1,
        totalElapsedTimeMilli: 100,
        maxElapsedTimeMilli: 100,
        lastElapsedTimeMilli: 100,
      },
    });
    const result = mergeSQLHistoryPerformance(previous, 50);
    expect(result).not.toHaveProperty("dynamoDb");
  });
});

describe("averageCapacityUnits", () => {
  it("capacitySampleCountが0または未設定ならundefinedを返す", () => {
    expect(
      averageCapacityUnits({ sampleCount: 1, totalElapsedTimeMilli: 1, maxElapsedTimeMilli: 1, lastElapsedTimeMilli: 1 })
    ).toBeUndefined();
    expect(
      averageCapacityUnits({
        sampleCount: 1,
        totalElapsedTimeMilli: 1,
        maxElapsedTimeMilli: 1,
        lastElapsedTimeMilli: 1,
        capacitySampleCount: 0,
        totalCapacityUnits: 0,
      })
    ).toBeUndefined();
  });

  it("capacitySampleCountがあれば total / count を返す", () => {
    expect(
      averageCapacityUnits({
        sampleCount: 4,
        totalElapsedTimeMilli: 400,
        maxElapsedTimeMilli: 150,
        lastElapsedTimeMilli: 90,
        capacitySampleCount: 4,
        totalCapacityUnits: 20,
        maxCapacityUnits: 8,
        lastCapacityUnits: 5,
      })
    ).toBe(5);
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

describe("migrateStoredSQLHistory", () => {
  it("adds DynamoQueryPanel provenance to native Query history saved before origin existed", () => {
    const migrated = migrateStoredSQLHistory({
      id: "legacy-native-query",
      connectionName: "dynamo",
      sqlDoc: "DynamoDB Query orders",
      request: {
        kind: "dynamodbQuery",
        input: {
          TableName: "orders",
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeValues: { ":pk": { S: "T#001" } },
        },
        structuralKey: "key",
        displayText: "DynamoDB Query orders",
      } as any,
    });

    expect(migrated?.request).toMatchObject({
      kind: "dynamodbQuery",
      origin: "dynamoQueryPanel",
    });
  });
});
