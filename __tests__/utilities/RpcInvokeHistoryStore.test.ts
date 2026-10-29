import { Memento } from "vscode";
import { describe, expect, it } from "vitest";
import { RpcHistoryItem } from "../../src/treeData/history/RpcHistoryTreeItem";
import { RpcHistoryRequestCapture, RPC_HISTORY_REQUEST_MAX_BYTES } from "../../src/utilities/RpcHistoryRequestCapture";
import { RpcInvokeHistoryAttempt, RpcInvokeHistoryStore } from "../../src/utilities/RpcInvokeHistoryStore";

const state = () => {
  const data = new Map<string, unknown>();
  return {
    data,
    memento: {
      get: (key: string, fallback: unknown) => data.get(key) ?? fallback,
      update: async (key: string, value: unknown) => { data.set(key, value); },
    } as Memento,
  };
};

const attempt = (
  request: string[],
  kind: RpcInvokeHistoryAttempt["callKind"] = "unary",
  outcome: RpcInvokeHistoryAttempt["outcome"] = "success"
): RpcInvokeHistoryAttempt => {
  const requestCapture = new RpcHistoryRequestCapture(
    kind === "clientStreaming" || kind === "bidiStreaming"
  );
  request.forEach((item) => requestCapture.add(item));
  return {
    connectionName: "rpc",
    service: "fixture.Service",
    method: "Call",
    path: "/fixture.Service/Call",
    callKind: kind,
    startedAt: Date.now() - 10,
    totalElapsedMs: 10,
    sentCount: request.length,
    receivedCount: 1,
    outcome,
    requestCapture,
  };
};

describe("RpcInvokeHistoryStore", () => {
  it("groups equivalent Data and preserves a successful result after a failed retry", async () => {
    const { data, memento } = state();
    const store = new RpcInvokeHistoryStore(memento);
    await store.add({
      ...attempt(['{"b":2,"a":1}']),
      requestMetadata: { "x-trace-id": "successful" },
    });
    const initial = (await store.list())[0];
    await store.add({
      ...attempt(['{ "a": 1, "b": 2 }'], "unary", "error"),
      requestMetadata: { "x-trace-id": "failed" },
    });
    const [grouped] = await store.list();
    expect((await store.list())).toHaveLength(1);
    expect(grouped.id).toBe(initial.id);
    expect(grouped.executionCount).toBe(2);
    expect(grouped.outcome).toBe("success");
    expect(grouped.lastErrorOutcome).toBe("error");
    expect(grouped.lastErrorAt).toBeGreaterThanOrEqual(grouped.executedAt);
    expect(grouped.requestJson).toBe('{"a":1,"b":2}');
    expect(grouped.requestMetadata).toEqual({ "x-trace-id": "successful" });
    expect(new RpcHistoryItem(grouped).contextValue).toBe("rpcInvokeHistoryRestorable");
    expect(new RpcHistoryItem(grouped).command).toBeUndefined();
    expect(data.has("database-notebook-rpc-invoke-history-v3")).toBe(true);
  });

  it("stores an ordered stream as one history and hashes Data beyond the storage limit", async () => {
    const store = new RpcInvokeHistoryStore(state().memento);
    await store.add({
      ...attempt(['{"value":1}', '{"value":2}'], "bidiStreaming"),
      requestMetadata: {},
    });
    const [stream] = await store.list();
    expect(stream.requestJson).toBe('[{"value":1},{"value":2}]');
    expect(stream.requestMetadata).toBeUndefined();
    expect("requestMetadata" in stream).toBe(false);
    expect(new RpcHistoryItem(stream).command).toBeUndefined();
    expect(new RpcHistoryItem(stream).contextValue).toBe("rpcInvokeHistoryNotebookOnly");
    expect(new RpcHistoryItem({ ...stream, requestJson: undefined }).contextValue)
      .toBe("rpcInvokeHistory");
    await store.add(attempt(['{"value":2}', '{"value":1}'], "bidiStreaming"));
    expect(await store.list()).toHaveLength(2);

    const large = `{"data":"${"x".repeat(RPC_HISTORY_REQUEST_MAX_BYTES)}"}`;
    await store.add(attempt([large], "unary"));
    await store.add(attempt([large], "unary"));
    const [oversized] = await store.list();
    expect(oversized.executionCount).toBe(2);
    expect(oversized.requestJson).toBeUndefined();
    expect(oversized.requestDigest).toHaveLength(64);
    expect(new RpcHistoryItem(oversized).contextValue).toBe("rpcInvokeHistoryPanelOnly");
  });
});
