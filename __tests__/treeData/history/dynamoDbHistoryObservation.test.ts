import { describe, expect, it } from "vitest";
import type { QueryHistory } from "../../../src/types/QueryHistory";
import {
  buildObservationFromHistory,
  toPerformanceCapacityBreakdown,
} from "../../../src/treeData/history/dynamoDbHistoryObservation";

const baseHistory = (overrides: Partial<QueryHistory> = {}): QueryHistory => ({
  id: "h1",
  sqlDoc: "DynamoDB Query orders",
  connectionName: "conn1",
  status: "success",
  ...overrides,
});

describe("toPerformanceCapacityBreakdown", () => {
  it("maps totalCapacityUnits/totalReadCapacityUnits/totalWriteCapacityUnits explicitly, not via a cast", () => {
    const result = toPerformanceCapacityBreakdown({
      totalCapacityUnits: 5,
      totalReadCapacityUnits: 3,
      totalWriteCapacityUnits: 2,
    });
    expect(result).toEqual({
      capacityUnits: 5,
      readCapacityUnits: 3,
      writeCapacityUnits: 2,
    });
  });

  it("maps table/lsi/gsi amounts", () => {
    const result = toPerformanceCapacityBreakdown({
      totalCapacityUnits: 10,
      table: { capacityUnits: 6 },
      localSecondaryIndexes: { lsiStatus: { capacityUnits: 2 } },
      globalSecondaryIndexes: { gsiCountry: { capacityUnits: 2 } },
    });
    expect(result?.table).toEqual({ capacityUnits: 6, readCapacityUnits: undefined, writeCapacityUnits: undefined });
    expect(result?.localSecondaryIndexes).toEqual({
      lsiStatus: { capacityUnits: 2, readCapacityUnits: undefined, writeCapacityUnits: undefined },
    });
    expect(result?.globalSecondaryIndexes).toEqual({
      gsiCountry: { capacityUnits: 2, readCapacityUnits: undefined, writeCapacityUnits: undefined },
    });
  });

  it("returns undefined for undefined input", () => {
    expect(toPerformanceCapacityBreakdown(undefined)).toBeUndefined();
  });

  it("omits empty lsi/gsi maps rather than setting an empty object", () => {
    const result = toPerformanceCapacityBreakdown({ totalCapacityUnits: 1 });
    expect(result).not.toHaveProperty("localSecondaryIndexes");
    expect(result).not.toHaveProperty("globalSecondaryIndexes");
    expect(result).not.toHaveProperty("table");
  });
});

describe("buildObservationFromHistory", () => {
  it("does not resurrect a pre-reset summary as current measurement evidence", () => {
    const history = baseHistory({
      executedAt: 1000,
      performance: {
        sampleCount: 0,
        totalElapsedTimeMilli: 0,
        statisticsSince: 2000,
        resetAt: 2000,
      },
      summary: { dynamoDb: { returnedItemCount: 3 } } as any,
    });
    expect(buildObservationFromHistory(history)).toBeUndefined();
  });

  it("returns undefined when summary.dynamoDb is absent (dev-era history, or a non-AWS connection)", () => {
    const history = baseHistory({ summary: { info: "1 row", elapsedTimeMilli: 10, selectedRows: 1 } as any });
    expect(buildObservationFromHistory(history)).toBeUndefined();
  });

  it("builds a complete observation when continuationTokenPresent is false", () => {
    const history = baseHistory({
      executedAt: new Date("2026-08-26T00:00:00Z").getTime(),
      summary: {
        info: "x",
        elapsedTimeMilli: 12,
        dynamoDb: {
          apiOperation: "Query",
          returnedItemCount: 25,
          evaluatedItemCount: 100,
          successfulResponseCount: 1,
          sdkRetryCount: 0,
          continuationTokenPresent: false,
          consumedCapacity: { totalCapacityUnits: 1.5 },
        },
      } as any,
    });
    const observation = buildObservationFromHistory(history);
    expect(observation).toEqual({
      source: "sqlHistory",
      observedAt: "2026-08-26T00:00:00.000Z",
      clientElapsedTimeMs: 12,
      requestCount: 1,
      retryCount: 0,
      returnedItemCount: 25,
      evaluatedItemCount: 100,
      filterPassRate: 0.25,
      consumedCapacity: { capacityUnits: 1.5, readCapacityUnits: undefined, writeCapacityUnits: undefined },
      hasMorePages: false,
      bounded: false,
      boundDescription: undefined,
      completeness: "complete",
    });
  });

  it("builds a bounded observation, with a bounded note, when continuationTokenPresent is true", () => {
    const history = baseHistory({
      summary: {
        info: "x",
        elapsedTimeMilli: 5,
        dynamoDb: {
          apiOperation: "Query",
          returnedItemCount: 0,
          evaluatedItemCount: 100,
          continuationTokenPresent: true,
        },
      } as any,
    });
    const observation = buildObservationFromHistory(history);
    expect(observation?.completeness).toBe("bounded");
    expect(observation?.bounded).toBe(true);
    expect(observation?.boundDescription).toMatch(/continuation key/);
    // A 0-item bounded page must never be described as the full result.
    expect(observation?.returnedItemCount).toBe(0);
  });

  it("marks completeness 'unknown' (not 'complete') when continuationTokenPresent itself is undefined", () => {
    const history = baseHistory({
      summary: {
        info: "x",
        elapsedTimeMilli: 5,
        dynamoDb: { apiOperation: "Query", returnedItemCount: 10, evaluatedItemCount: 10 },
      } as any,
    });
    const observation = buildObservationFromHistory(history);
    expect(observation?.completeness).toBe("unknown");
    expect(observation?.bounded).toBe(true);
  });

  it("leaves filterPassRate undefined for a PartiQL summary (no evaluatedItemCount)", () => {
    const history = baseHistory({
      summary: {
        info: "x",
        elapsedTimeMilli: 5,
        dynamoDb: { apiOperation: "ExecuteStatement", returnedItemCount: 3, continuationTokenPresent: false },
      } as any,
    });
    const observation = buildObservationFromHistory(history);
    expect(observation?.evaluatedItemCount).toBeUndefined();
    expect(observation?.filterPassRate).toBeUndefined();
  });

  it("does not compute a filterPassRate when evaluatedItemCount is 0", () => {
    const history = baseHistory({
      summary: {
        info: "x",
        elapsedTimeMilli: 5,
        dynamoDb: {
          apiOperation: "Query",
          returnedItemCount: 0,
          evaluatedItemCount: 0,
          continuationTokenPresent: false,
        },
      } as any,
    });
    const observation = buildObservationFromHistory(history);
    expect(observation?.filterPassRate).toBeUndefined();
  });
});
