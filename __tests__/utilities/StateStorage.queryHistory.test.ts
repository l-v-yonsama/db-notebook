import { describe, expect, it } from "vitest";
import type { ExtensionContext, SecretStorage } from "vscode";
import { QUERY_HISTORY_STORAGE_KEY, StateStorage } from "../../src/utilities/StateStorage";

// Minimal in-memory stand-in for ExtensionContext.globalState, just enough
// for StateStorage's query history methods (get/update).
const createFakeContext = (initialHistories: unknown[] = []): ExtensionContext => {
  const store = new Map<string, unknown>();
  store.set(QUERY_HISTORY_STORAGE_KEY, initialHistories);
  return {
    globalState: {
      get: (key: string, defaultValue?: unknown) =>
        store.has(key) ? store.get(key) : defaultValue,
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
  } as unknown as ExtensionContext;
};

const createStateStorage = (initialHistories: unknown[] = []) =>
  new StateStorage(createFakeContext(initialHistories), {} as SecretStorage);

describe("StateStorage.addQueryHistory performance aggregation", () => {
  it("resets only the performance trip meter and preserves SQL/result metadata", async () => {
    const stateStorage = createStateStorage();
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select * from t",
      summary: { elapsedTimeMilli: 100, selectedRows: 4 } as any,
      status: "success",
      executedAt: 1000,
    });
    const before = await stateStorage.getQueryHistoryList();

    expect(await stateStorage.resetQueryHistoryPerformanceByID(before[0].id, 2000)).toBe(true);
    const [after] = await stateStorage.getQueryHistoryList();
    expect(after.sqlDoc).toBe("select * from t");
    expect(after.summary?.selectedRows).toBe(4);
    expect(after.performance).toMatchObject({
      sampleCount: 0,
      totalElapsedTimeMilli: 0,
      statisticsSince: 2000,
      resetAt: 2000,
    });
    expect(after.performance).not.toHaveProperty("maxElapsedTimeMilli");
    expect(after.performance).not.toHaveProperty("lastElapsedTimeMilli");
  });

  it("同一SQL・同一接続の再実行でsampleCountとtotal/maxが積み上がる", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select * from t",
      summary: { elapsedTimeMilli: 100 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select * from t",
      summary: { elapsedTimeMilli: 300 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(1);
    expect(list[0].performance).toEqual({
      sampleCount: 2,
      totalElapsedTimeMilli: 400,
      maxElapsedTimeMilli: 300,
      lastElapsedTimeMilli: 300,
    });
  });

  it("計測値の無いエラー実行では集計を崩さない", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select * from t",
      summary: { elapsedTimeMilli: 50 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select * from t",
      status: "error",
      errorMessage: "boom",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list[0].status).toBe("success");
    expect(list[0].summary?.elapsedTimeMilli).toBe(50);
    expect(list[0].lastErrorMessage).toBe("boom");
    expect(list[0].performance).toEqual({
      sampleCount: 1,
      totalElapsedTimeMilli: 50,
      maxElapsedTimeMilli: 50,
      lastElapsedTimeMilli: 50,
    });

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select * from t",
      summary: { elapsedTimeMilli: 25 } as any,
      status: "success",
    });
    const recovered = await stateStorage.getQueryHistoryList();
    expect(recovered[0].status).toBe("success");
    expect(recovered[0].lastErrorMessage).toBeUndefined();
    expect(recovered[0].performance).toEqual({
      sampleCount: 2,
      totalElapsedTimeMilli: 75,
      maxElapsedTimeMilli: 50,
      lastElapsedTimeMilli: 25,
    });
  });

  it("EXPLAIN文は保存境界で拒否する", async () => {
    const stateStorage = createStateStorage();

    const added = await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "/* plan */ EXPLAIN (FORMAT JSON) SELECT * FROM t",
      status: "success",
      summary: { elapsedTimeMilli: 10 } as any,
    });

    expect(added).toBe(false);
    expect(await stateStorage.getQueryHistoryList()).toEqual([]);
  });

  it("旧履歴を読み込み時に移行し、Explain系を除外する", async () => {
    const stateStorage = createStateStorage([
      {
        id: "query",
        connectionName: "conn1",
        sqlDoc: "select * from t",
        status: "success",
        sqlMode: "Query",
        summary: { elapsedTimeMilli: 80 },
      },
      {
        id: "explain-mode",
        connectionName: "conn1",
        sqlDoc: "select * from t",
        status: "success",
        sqlMode: "Explain",
        summary: { elapsedTimeMilli: 5 },
      },
      {
        id: "explain-meta",
        connectionName: "conn1",
        sqlDoc: "select * from t2",
        status: "success",
        meta: { type: "analyze" },
        summary: { elapsedTimeMilli: 6 },
      },
    ]);

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("sqlMode");
    expect(list[0].performance).toEqual({
      sampleCount: 1,
      totalElapsedTimeMilli: 80,
      maxElapsedTimeMilli: 80,
      lastElapsedTimeMilli: 80,
    });
  });

  it("異なるSQL/接続は別エントリとして先頭に積まれる", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select 1",
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select 2",
      summary: { elapsedTimeMilli: 20 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(2);
    expect(list[0].sqlDoc).toBe("select 2");
    expect(list[0].performance?.sampleCount).toBe(1);
    expect(list[1].performance?.sampleCount).toBe(1);
  });

  it("既存SQLを再実行すると先頭へ移動する(LRU)", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select 1",
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select 2",
      summary: { elapsedTimeMilli: 20 } as any,
      status: "success",
    });
    // Re-run "select 1" - it should jump back to the front.
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select 1",
      summary: { elapsedTimeMilli: 30 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list.map((it) => it.sqlDoc)).toEqual(["select 1", "select 2"]);
    expect(list[0].performance).toEqual({
      sampleCount: 2,
      totalElapsedTimeMilli: 40,
      maxElapsedTimeMilli: 30,
      lastElapsedTimeMilli: 30,
    });
  });

  it("50件上限でも直近再実行したSQLは新規SQLに押し出されず生き残る", async () => {
    const stateStorage = createStateStorage();

    for (let i = 0; i < 50; i++) {
      await stateStorage.addQueryHistory({
        connectionName: "conn1",
        sqlDoc: `select ${i}`,
        summary: { elapsedTimeMilli: 1 } as any,
        status: "success",
      });
    }
    // "select 0" is now the oldest entry (last position). Re-run it so it
    // moves to the front instead of getting evicted by the next new query.
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select 0",
      summary: { elapsedTimeMilli: 5 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "select 50",
      summary: { elapsedTimeMilli: 1 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(50);
    expect(list.some((it) => it.sqlDoc === "select 0")).toBe(true);
    expect(list[0].sqlDoc).toBe("select 50");
  });
});

describe("StateStorage.addQueryHistory native Query (dynamodbQuery) identity", () => {
  const dynamoRequest = (structuralKey: string, limit: number) => ({
    kind: "dynamodbQuery" as const,
    origin: "dynamoQueryPanel" as const,
    structuralKey,
    displayText: "DynamoDB Query orders\nKey: #pk = :pk",
    input: {
      TableName: "orders",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: `v-${limit}` } },
      Limit: limit,
    },
  });

  it("uses summary.dynamoDb as the sole DynamoDB Capacity source", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "",
      request: dynamoRequest("capacity-source", 10),
      summary: {
        elapsedTimeMilli: 10,
        capacityUnits: 99,
        dynamoDb: {
          apiOperation: "Query",
          consumedCapacity: { totalCapacityUnits: 2.5 },
        },
      } as any,
      status: "success",
    });

    const [history] = await stateStorage.getQueryHistoryList();
    expect(history.performance?.totalCapacityUnits).toBe(2.5);
    expect(history.performance?.lastCapacityUnits).toBe(2.5);
  });

  it("merges repeated executions with the same structuralKey into one entry, even with an empty sqlDoc", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "",
      request: dynamoRequest("k1", 1),
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "",
      request: dynamoRequest("k1", 1),
      summary: { elapsedTimeMilli: 20 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(1);
    expect(list[0].performance?.sampleCount).toBe(2);
  });

  it("treats a different structuralKey as a separate entry, even with identical sqlDoc text", async () => {
    const stateStorage = createStateStorage();
    const sameDisplayText = "DynamoDB Query orders\nKey: #pk = :pk";

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: sameDisplayText,
      request: dynamoRequest("k1", 1),
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: sameDisplayText,
      request: dynamoRequest("k2", 1),
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(2);
  });

  it("does not collide with an unrelated sql-kind history sharing the same sqlDoc text", async () => {
    const stateStorage = createStateStorage();
    const sharedText = "DynamoDB Query orders\nKey: #pk = :pk";

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: sharedText,
      summary: { elapsedTimeMilli: 5 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: sharedText,
      request: dynamoRequest("k1", 1),
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(2);
  });

  it("keeps the latest real input on a successful re-run", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "",
      request: dynamoRequest("k1", 1),
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "",
      request: dynamoRequest("k1", 2),
      summary: { elapsedTimeMilli: 10 } as any,
      status: "success",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(1);
    const req = list[0].request;
    expect(req?.kind === "dynamodbQuery" && req.input.Limit).toBe(2);
  });

  it("a failed re-run keeps the prior successful input/summary and only records the error", async () => {
    const stateStorage = createStateStorage();

    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "",
      request: dynamoRequest("k1", 1),
      summary: { elapsedTimeMilli: 10, selectedRows: 5 } as any,
      status: "success",
    });
    await stateStorage.addQueryHistory({
      connectionName: "conn1",
      sqlDoc: "",
      request: dynamoRequest("k1", 1),
      status: "error",
      errorMessage: "ProvisionedThroughputExceededException",
    });

    const list = await stateStorage.getQueryHistoryList();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("success");
    expect(list[0].summary?.selectedRows).toBe(5);
    expect(list[0].lastErrorMessage).toBe("ProvisionedThroughputExceededException");
  });
});
