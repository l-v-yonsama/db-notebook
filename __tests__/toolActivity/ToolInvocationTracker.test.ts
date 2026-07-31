import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ToolInvocationTrackerModule from "../../src/toolActivity/ToolInvocationTracker";

// Fresh module state per test (the tracker deliberately keeps module-level,
// in-memory-only state -- see the file header in ToolInvocationTracker.ts).
let tracker: typeof ToolInvocationTrackerModule;

beforeEach(async () => {
  vi.resetModules();
  tracker = await import("../../src/toolActivity/ToolInvocationTracker");
});

describe("trackInvocation", () => {
  it("成功時: 戻り値をそのまま返し、historyの先頭にsuccessレコードを積む", async () => {
    const result = await tracker.trackInvocation(
      "lmTools",
      "GetSchemaTool",
      { connectionName: "db1" },
      async () => "schema text"
    );

    expect(result).toBe("schema text");
    const history = tracker.getHistory("lmTools");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      source: "lmTools",
      toolName: "GetSchemaTool",
      status: "success",
      outputSummary: "schema text",
    });
    expect(history[0].inputSummary).toContain("connectionName");
    expect(history[0].id).toBeTruthy();
    expect(history[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("失敗時: エラーをrethrowしつつ、errorステータスで記録する", async () => {
    const error = new Error("boom");

    await expect(
      tracker.trackInvocation("mcpServer", "runDbQuery", { sql: "select 1" }, async () => {
        throw error;
      })
    ).rejects.toThrow("boom");

    const history = tracker.getHistory("mcpServer");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "error", outputSummary: "boom" });
  });

  it("ソースごとに独立したFIFO(最大10件)を保持し、11件目で最も古い履歴を捨てる", async () => {
    for (let i = 0; i < 11; i++) {
      await tracker.trackInvocation("lmTools", `Tool${i}`, {}, async () => `result-${i}`);
    }

    const history = tracker.getHistory("lmTools");
    expect(history).toHaveLength(10);
    expect(history[0].toolName).toBe("Tool10"); // newest first
    expect(history[9].toolName).toBe("Tool1");
    expect(history.some((h) => h.toolName === "Tool0")).toBe(false);
    expect(tracker.getHistory("mcpServer")).toHaveLength(0);
  });

  it("実行中はisActiveがtrueになり、完了後にfalseへ戻る", async () => {
    let resolveFn: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveFn = resolve;
    });

    expect(tracker.isActive("mcpServer")).toBe(false);

    const invocation = tracker.trackInvocation("mcpServer", "getDbSchema", {}, () => pending);
    // trackInvocation runs synchronously up to its first `await`, so the
    // counter is already incremented by the time this line runs.
    expect(tracker.isActive("mcpServer")).toBe(true);

    resolveFn("done");
    await invocation;
    expect(tracker.isActive("mcpServer")).toBe(false);
  });

  it("onDidChangeActivityが開始時・終了時の2回、該当sourceを伴って発火する", async () => {
    const events: string[] = [];
    const disposable = tracker.onDidChangeActivity((source) => events.push(source));

    await tracker.trackInvocation("lmTools", "ListConnectionsTool", {}, async () => "ok");
    expect(events).toEqual(["lmTools", "lmTools"]);

    disposable.dispose();
    await tracker.trackInvocation("lmTools", "ListConnectionsTool", {}, async () => "ok");
    expect(events).toEqual(["lmTools", "lmTools"]); // dispose後は増えない
  });

  it("オブジェクトの入力/出力はJSON文字列に要約される", async () => {
    const result = await tracker.trackInvocation(
      "mcpServer",
      "scanDbResource",
      { connectionName: "redis1", redis: { keyGlob: "session:*" } },
      async () => ({ ok: true, rows: 3 })
    );

    expect(result).toEqual({ ok: true, rows: 3 });
    const [entry] = tracker.getHistory("mcpServer");
    expect(entry.inputSummary).toContain("session:*");
    expect(entry.outputSummary).toContain('"rows":3');
  });

  it("長い文字列はabbrで中間省略される", async () => {
    const longText = "x".repeat(1000);
    await tracker.trackInvocation("lmTools", "RunQueryTool", {}, async () => longText);

    const [entry] = tracker.getHistory("lmTools");
    expect(entry.outputSummary.length).toBeLessThan(longText.length);
    expect(entry.outputSummary).toContain("..");
  });
});
