import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ToolInvocationTrackerModule from "../../../src/treeData/toolActivity/ToolInvocationTracker";

// Fresh module state per test (the tracker deliberately keeps module-level,
// in-memory-only state -- see the file header in ToolInvocationTracker.ts).
let tracker: typeof ToolInvocationTrackerModule;

// finish() pads its bookkeeping (counter/history/event) via setTimeout, so every test
// that inspects state *after* a call completes needs fake timers advanced past
// MIN_VISIBLE_RUNNING_MS -- see that constant's doc comment for why the padding exists.
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(tracker.MIN_VISIBLE_RUNNING_MS);
};

beforeEach(async () => {
  vi.resetModules();
  tracker = await import("../../../src/treeData/toolActivity/ToolInvocationTracker");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
    await settle();

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
    await settle();

    const history = tracker.getHistory("mcpServer");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "error", outputSummary: "boom" });
  });

  it("ソースごとに独立したFIFO(最大10件)を保持し、11件目で最も古い履歴を捨てる", async () => {
    for (let i = 0; i < 11; i++) {
      await tracker.trackInvocation("lmTools", `Tool${i}`, {}, async () => `result-${i}`);
    }
    await settle();

    const history = tracker.getHistory("lmTools");
    expect(history).toHaveLength(10);
    expect(history[0].toolName).toBe("Tool10"); // newest first
    expect(history[9].toolName).toBe("Tool1");
    expect(history.some((h) => h.toolName === "Tool0")).toBe(false);
    expect(tracker.getHistory("mcpServer")).toHaveLength(0);
  });

  it("実行中(および完了後の最低表示時間中)はisActiveがtrueになり、その後falseへ戻る", async () => {
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
    // fn() has resolved, but bookkeeping (and thus the counter decrement) is
    // deliberately padded out to MIN_VISIBLE_RUNNING_MS -- still "active".
    expect(tracker.isActive("mcpServer")).toBe(true);

    await settle();
    expect(tracker.isActive("mcpServer")).toBe(false);
  });

  it("onDidChangeActivityが開始時・終了時の2回、該当sourceを伴って発火する", async () => {
    const events: string[] = [];
    const disposable = tracker.onDidChangeActivity((source) => events.push(source));

    await tracker.trackInvocation("lmTools", "ListConnectionsTool", {}, async () => "ok");
    await settle();
    expect(events).toEqual(["lmTools", "lmTools"]);

    disposable.dispose();
    await tracker.trackInvocation("lmTools", "ListConnectionsTool", {}, async () => "ok");
    await settle();
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
    await settle();

    const [entry] = tracker.getHistory("mcpServer");
    expect(entry.inputSummary).toContain("session:*");
    expect(entry.outputSummary).toContain('"rows":3');
  });

  it("長い文字列はabbrで中間省略される", async () => {
    const longText = "x".repeat(1000);
    await tracker.trackInvocation("lmTools", "RunQueryTool", {}, async () => longText);
    await settle();

    const [entry] = tracker.getHistory("lmTools");
    expect(entry.outputSummary.length).toBeLessThan(longText.length);
    expect(entry.outputSummary).toContain("..");
  });
});

describe("最低表示時間のパディング(MIN_VISIBLE_RUNNING_MS)", () => {
  it("速く完了しても呼び出し元への応答は即座に返る -- 遅延するのはbookkeepingだけ", async () => {
    const result = await tracker.trackInvocation("lmTools", "FastTool", {}, async () => "ok");
    expect(result).toBe("ok"); // 呼び出し元(Copilot/MCPクライアント)は待たされない

    // 完了直後はまだカウンタ減算・履歴追加・終了イベントが反映されていない。
    expect(tracker.isActive("lmTools")).toBe(true);
    expect(tracker.getHistory("lmTools")).toHaveLength(0);

    await settle();

    expect(tracker.isActive("lmTools")).toBe(false);
    expect(tracker.getHistory("lmTools")).toHaveLength(1);
  });

  it("最低表示時間より遅い呼び出しは追加の遅延なしに反映され、実際の所要時間が記録される", async () => {
    let resolveFn: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveFn = resolve;
    });

    const invocation = tracker.trackInvocation("lmTools", "SlowTool", {}, () => pending);
    const realElapsedMs = tracker.MIN_VISIBLE_RUNNING_MS + 500;
    await vi.advanceTimersByTimeAsync(realElapsedMs); // fn()がまだ処理中のうちに閾値を超えて時間を進める
    resolveFn("done");

    const result = await invocation;
    expect(result).toBe("done"); // ここでも応答自体は即座

    await vi.advanceTimersByTimeAsync(0); // delay=0で予約されたタイマーを1tick進めて反映させる

    expect(tracker.isActive("lmTools")).toBe(false);
    const [entry] = tracker.getHistory("lmTools");
    expect(entry.durationMs).toBeGreaterThanOrEqual(realElapsedMs);
  });
});

describe("getTotalCount", () => {
  it("成功・失敗を問わず完了ごとに増え、historyの10件上限とは独立してカウントし続ける", async () => {
    expect(tracker.getTotalCount("lmTools")).toBe(0);

    for (let i = 0; i < 12; i++) {
      await tracker.trackInvocation("lmTools", `Tool${i}`, {}, async () => "ok");
    }
    await settle();

    expect(tracker.getTotalCount("lmTools")).toBe(12);
    expect(tracker.getHistory("lmTools")).toHaveLength(10); // historyは上限どおり10件のまま
  });

  it("失敗した呼び出しもtotalCountに数える", async () => {
    await expect(
      tracker.trackInvocation("mcpServer", "runDbQuery", {}, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await settle();

    expect(tracker.getTotalCount("mcpServer")).toBe(1);
  });
});

describe("clearHistory", () => {
  it("historyとtotalCountの両方を空にし、指定したsourceだけに影響する", async () => {
    await tracker.trackInvocation("lmTools", "GetSchemaTool", {}, async () => "ok");
    await tracker.trackInvocation("mcpServer", "getDbSchema", {}, async () => "ok");
    await settle();
    expect(tracker.getHistory("lmTools")).toHaveLength(1);
    expect(tracker.getTotalCount("lmTools")).toBe(1);

    tracker.clearHistory("lmTools");

    expect(tracker.getHistory("lmTools")).toHaveLength(0);
    expect(tracker.getTotalCount("lmTools")).toBe(0);
    // mcpServer側は無関係のまま
    expect(tracker.getHistory("mcpServer")).toHaveLength(1);
    expect(tracker.getTotalCount("mcpServer")).toBe(1);
  });

  it("onDidChangeActivityを発火し、ツリーが再描画されるようにする", () => {
    const events: string[] = [];
    tracker.onDidChangeActivity((source) => events.push(source));

    tracker.clearHistory("mcpServer");

    expect(events).toEqual(["mcpServer"]);
  });
});
