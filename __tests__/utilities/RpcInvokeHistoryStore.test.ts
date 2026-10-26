import { Memento } from "vscode";
import { describe, expect, it, vi } from "vitest";
import { RpcInvokeHistoryStore } from "../../src/utilities/RpcInvokeHistoryStore";
import { RpcInvokeHistory } from "../../src/types/RpcInvokeHistory";
import { RpcHistoryTreeProvider } from "../../src/treeData/history/RpcHistoryTreeProvider";
import { RPC_HISTORY_REQUEST_MAX_BYTES } from "../../src/utilities/RpcInvokeHistoryStore";

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
      requestJson: '{"value":1}',
      metadata: { authorization: "secret token" },
    } as Omit<RpcInvokeHistory, "id">)));
    const list = await store.list();
    expect(list).toHaveLength(50);
    expect(list[0].method).toBe("Call54");
    expect(list[49].method).toBe("Call5");
    expect(changed).toHaveBeenCalledTimes(55);
    expect(list[0].requestJson).toBe('{"value":1}');
    expect(JSON.stringify(data.get("database-notebook-rpc-invoke-history"))).not.toContain("secret");
    expect(data.get("database-notebook-sql-history")).toEqual([{ id: "sql" }]);

    await store.delete(list[0].id);
    expect(await store.list()).toHaveLength(49);
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(data.get("database-notebook-sql-history")).toEqual([{ id: "sql" }]);
  });

  it("restores only bounded unary and server-streaming requests", async () => {
    const data = new Map<string, unknown>();
    const state = {
      get: (key: string, fallback: unknown) => data.get(key) ?? fallback,
      update: async (key: string, value: unknown) => { data.set(key, value); },
    } as Memento;
    const store = new RpcInvokeHistoryStore(state);
    await store.add({ ...sample(1), requestJson: '{"name":"Alice"}' });
    await store.add({ ...sample(2), callKind: "serverStreaming", requestJson: '{"id":2}' });
    await store.add({ ...sample(3), callKind: "clientStreaming", requestJson: '{"id":3}' });
    await store.add({ ...sample(4), callKind: "bidiStreaming", requestJson: '{"id":4}' });
    await store.add({ ...sample(5), requestJson: "x".repeat(RPC_HISTORY_REQUEST_MAX_BYTES + 1) });
    const list = await store.list();
    expect(list.map((item) => item.requestJson)).toEqual([
      undefined, undefined, undefined, '{"id":2}', '{"name":"Alice"}',
    ]);
    const provider = new RpcHistoryTreeProvider(store);
    expect(provider.getTreeItem(list[0]).command).toBeUndefined();
    expect(provider.getTreeItem(list[1]).command).toBeUndefined();
    expect(provider.getTreeItem(list[3]).command).toMatchObject({
      command: "database-notebook.rpc-histories.openInInvokePanel",
    });
    expect(String(provider.getTreeItem(list[4]).tooltip)).not.toContain("Alice");
  });
});
