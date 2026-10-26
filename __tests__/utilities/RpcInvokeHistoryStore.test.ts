import { Memento } from "vscode";
import { describe, expect, it, vi } from "vitest";
import { RpcInvokeHistoryStore } from "../../src/utilities/RpcInvokeHistoryStore";
import { RpcInvokeHistory } from "../../src/types/RpcInvokeHistory";

const sample = (index: number): Omit<RpcInvokeHistory, "id"> => ({
  connectionName: "rpc",
  service: "fixture.Service",
  method: `Call${index}`,
  path: `/fixture.Service/Call${index}`,
  callKind: "unary",
  invokedAt: index,
  totalElapsedMs: 10,
  sentCount: 1,
  receivedCount: 1,
  outcome: "success",
  grpcStatus: { code: 0, name: "OK" },
});

describe("RpcInvokeHistoryStore", () => {
  it("serializes concurrent updates, caps records at 50, and never stores extra data", async () => {
    const data = new Map<string, unknown>([["database-notebook-sql-history", [{ id: "sql" }]]]);
    const state = {
      get: vi.fn((key: string, fallback: unknown) => data.get(key) ?? fallback),
      update: vi.fn(async (key: string, value: unknown) => {
        await Promise.resolve();
        data.set(key, value);
      }),
    } as unknown as Memento;
    const store = new RpcInvokeHistoryStore(state);
    const changed = vi.fn();
    store.onDidChange(changed);

    await Promise.all(Array.from({ length: 55 }, (_, index) => store.add({
      ...sample(index),
      requestJson: "secret request",
      metadata: { authorization: "secret token" },
    } as Omit<RpcInvokeHistory, "id">)));
    const list = await store.list();
    expect(list).toHaveLength(50);
    expect(list[0].method).toBe("Call54");
    expect(list[49].method).toBe("Call5");
    expect(changed).toHaveBeenCalledTimes(55);
    expect(JSON.stringify(data.get("database-notebook-rpc-invoke-history"))).not.toContain("secret");
    expect(data.get("database-notebook-sql-history")).toEqual([{ id: "sql" }]);

    await store.delete(list[0].id);
    expect(await store.list()).toHaveLength(49);
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(data.get("database-notebook-sql-history")).toEqual([{ id: "sql" }]);
  });
});
