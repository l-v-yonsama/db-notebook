import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeIcon } from "vscode";
import type { ExtensionContext } from "vscode";
import { SHOW_INVOCATION_LOG } from "../../../src/constant";
import type {
  ToolActivityCategoryElement,
  ToolActivityHistoryElement,
} from "../../../src/treeData/toolActivity/ToolActivityTreeProvider";
import type * as ProviderModule from "../../../src/treeData/toolActivity/ToolActivityTreeProvider";
import type * as ToolInvocationTrackerModule from "../../../src/treeData/toolActivity/ToolInvocationTracker";

const { detectRunningServerMock, isRunningHereMock } = vi.hoisted(() => ({
  detectRunningServerMock: vi.fn(),
  isRunningHereMock: vi.fn(),
}));

vi.mock("../../../src/aiTools/mcpServer/singleton", () => ({
  detectRunningServer: detectRunningServerMock,
}));
vi.mock("../../../src/aiTools/mcpServer/server", () => ({
  isRunningHere: isRunningHereMock,
}));

let tracker: typeof ToolInvocationTrackerModule;
let providerModule: typeof ProviderModule;

const makeContext = (): ExtensionContext => ({}) as ExtensionContext;

// trackInvocation's bookkeeping (counter/history/event) is padded via setTimeout out to
// MIN_VISIBLE_RUNNING_MS -- see ToolInvocationTracker.ts's doc comment. Tests that seed
// history via trackInvocation and then immediately inspect provider state need this.
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(tracker.MIN_VISIBLE_RUNNING_MS);
};

beforeEach(async () => {
  vi.resetModules();
  detectRunningServerMock.mockReset().mockResolvedValue(undefined);
  isRunningHereMock.mockReset().mockReturnValue(false);
  tracker = await import("../../../src/treeData/toolActivity/ToolInvocationTracker");
  providerModule = await import("../../../src/treeData/toolActivity/ToolActivityTreeProvider");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ToolActivityTreeProvider.getChildren (ルート: カテゴリ2件)", () => {
  it("MCP Server未起動・LM Tools待機中なら、Stopped/Waitingになる", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    const [lmTools, mcpServer] = await provider.getChildren();

    expect(lmTools).toMatchObject({ kind: "category", source: "lmTools", status: "waiting" });
    expect(mcpServer).toMatchObject({
      kind: "category",
      source: "mcpServer",
      status: "stopped",
      runningElsewhere: false,
    });
    expect(provider.getTreeItem(lmTools).description).toBe("Waiting");
    expect(provider.getTreeItem(mcpServer).description).toBe("Stopped");
  });

  it("LM Toolsが呼び出し中はrunning状態になる(カウンタは呼び出し開始と同時に同期的に増える)", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    // 意図的にawaitしない -- trackInvocationは最初のawaitまで同期実行されるため、
    // ここに到達した時点でカウンタは既に+1されている。
    void tracker.trackInvocation("lmTools", "GetSchemaTool", {}, () => new Promise<string>(() => {}));

    const [lmTools] = await provider.getChildren();
    expect(lmTools).toMatchObject({ status: "running" });
    expect(provider.getTreeItem(lmTools).description).toBe("Running...");
  });

  it("MCP Serverがロックファイル上はRunningだがこのウィンドウ起動でない場合、別ウィンドウ注記になり履歴は空", async () => {
    detectRunningServerMock.mockResolvedValue({ url: "http://127.0.0.1:9999/db-notebook-mcp", token: "t" });
    isRunningHereMock.mockReturnValue(false);
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    const [, mcpServer] = await provider.getChildren();

    expect(mcpServer).toMatchObject({
      status: "waiting",
      runningElsewhere: true,
      serverUrl: "http://127.0.0.1:9999/db-notebook-mcp",
    });
    expect(provider.getTreeItem(mcpServer).description).toBe("Running (in another window)");
    expect(await provider.getChildren(mcpServer)).toEqual([]);
  });

  it("MCP Serverがこのウィンドウで起動中なら、待機中/実行中が切り替わり履歴が返る", async () => {
    detectRunningServerMock.mockResolvedValue({ url: "http://127.0.0.1:9999/db-notebook-mcp", token: "t" });
    isRunningHereMock.mockReturnValue(true);
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    await tracker.trackInvocation("mcpServer", "getDbSchema", { connectionName: "db1" }, async () => "CREATE TABLE t(id int)");
    await settle();

    const [, mcpServer] = await provider.getChildren();
    expect(mcpServer).toMatchObject({ status: "waiting", runningElsewhere: false });

    const children = await provider.getChildren(mcpServer);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      kind: "history",
      record: { toolName: "getDbSchema", source: "mcpServer", status: "success" },
    });
  });

  it("MCP Serverが未起動ならカテゴリの子は空配列(既存挙動を踏襲)", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    const [, mcpServer] = await provider.getChildren();
    expect(await provider.getChildren(mcpServer)).toEqual([]);
  });

  it("ソースごとに最大10件までしか子として返らない(Trackerの上限をそのまま反映する)", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    for (let i = 0; i < 11; i++) {
      await tracker.trackInvocation("lmTools", `Tool${i}`, {}, async () => `result-${i}`);
    }
    await settle();

    const [lmTools] = await provider.getChildren();
    const children = await provider.getChildren(lmTools);

    expect(children).toHaveLength(10);
  });
});

describe("ToolActivityTreeProvider: 呼び出し回数・最終呼び出し時刻の表示", () => {
  it("件数と最終呼び出し時刻(絶対時刻)がdescriptionに付与される", async () => {
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0));
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    await tracker.trackInvocation("lmTools", "GetSchemaTool", {}, async () => "ok");
    await settle();
    await tracker.trackInvocation("lmTools", "TestConnectionTool", {}, async () => "ok");
    await settle();

    const [lmTools] = await provider.getChildren();
    expect(provider.getTreeItem(lmTools).description).toBe("Waiting · 2 calls · last 09:00:00");
  });

  it("1件だけの場合は単数形(call)になる", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    await tracker.trackInvocation("lmTools", "GetSchemaTool", {}, async () => "ok");
    await settle();

    const [lmTools] = await provider.getChildren();
    expect(provider.getTreeItem(lmTools).description).toMatch(/^Waiting · 1 call · last \d{2}:\d{2}:\d{2}$/);
  });

  it("呼び出しが一度も無ければ付与しない(既存の簡潔な表示を維持)", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    const [lmTools] = await provider.getChildren();
    expect(provider.getTreeItem(lmTools).description).toBe("Waiting");
  });
});

describe("ToolActivityTreeProvider: 履歴クリアボタン用のcontextValue(hasHistory)", () => {
  it("呼び出し実績が無いカテゴリにはhasHistoryが付かない(クリアボタンが出ない)", async () => {
    detectRunningServerMock.mockResolvedValue({ url: "http://127.0.0.1:9999/db-notebook-mcp", token: "t" });
    isRunningHereMock.mockReturnValue(true);
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    const [lmTools, mcpServer] = await provider.getChildren();

    expect(provider.getTreeItem(lmTools).contextValue).toBe("toolActivityCategory,lmTools");
    expect(provider.getTreeItem(mcpServer).contextValue).toBe("toolActivityCategory,mcpServer,running");
  });

  it("呼び出し実績があるカテゴリにはhasHistoryが付く(既存のstopped/running表記は保たれる)", async () => {
    detectRunningServerMock.mockResolvedValue({ url: "http://127.0.0.1:9999/db-notebook-mcp", token: "t" });
    isRunningHereMock.mockReturnValue(true);
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    await tracker.trackInvocation("lmTools", "GetSchemaTool", {}, async () => "ok");
    await tracker.trackInvocation("mcpServer", "getDbSchema", {}, async () => "ok");
    await settle();

    const [lmTools, mcpServer] = await provider.getChildren();

    expect(provider.getTreeItem(lmTools).contextValue).toBe("toolActivityCategory,lmTools,hasHistory");
    expect(provider.getTreeItem(mcpServer).contextValue).toBe("toolActivityCategory,mcpServer,running,hasHistory");
  });

  it("MCP Server停止中でも、停止前の履歴が残っていればhasHistoryが付く", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    await tracker.trackInvocation("mcpServer", "getDbSchema", {}, async () => "ok");
    await settle();

    const [, mcpServer] = await provider.getChildren();

    expect(provider.getTreeItem(mcpServer).contextValue).toBe("toolActivityCategory,mcpServer,stopped,hasHistory");
  });
});

describe("ToolActivityTreeProvider: 履歴アイテム", () => {
  it("履歴要素は子を持たない", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    await tracker.trackInvocation("lmTools", "GetSchemaTool", {}, async () => "ok");
    await settle();

    const [lmTools] = await provider.getChildren();
    const [historyElement] = await provider.getChildren(lmTools);

    expect(await provider.getChildren(historyElement)).toEqual([]);
  });

  it("ラベル・時刻(所要時間)・アイコン・ツールチップ・クリックコマンドを持つ", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    await tracker.trackInvocation(
      "lmTools",
      "GetSchemaTool",
      { connectionName: "db1" },
      async () => "CREATE TABLE t(id int)"
    );
    await settle();

    const [lmTools] = await provider.getChildren();
    const [historyElement] = await provider.getChildren(lmTools);
    const item = provider.getTreeItem(historyElement);

    expect(item.label).toBe("GetSchemaTool");
    expect(item.description).toMatch(/^\d{2}:\d{2}:\d{2} \(\d+msec\)$/);
    expect((item.iconPath as ThemeIcon).id).toBe("symbol-structure");
    expect((item.iconPath as ThemeIcon).color).toBeUndefined();
    expect(item.contextValue).toBe("toolActivityHistory");

    const tooltip = item.tooltip as { value: string };
    expect(tooltip.value).toContain("connectionName");
    expect(tooltip.value).toContain("CREATE TABLE t(id int)");

    const record = (historyElement as ToolActivityHistoryElement).record;
    expect(item.command).toMatchObject({ command: SHOW_INVOCATION_LOG, arguments: [record] });
  });

  it("MCP側のツール名(getDbSchema等)もLM Tools側と同じアイコンになる", async () => {
    detectRunningServerMock.mockResolvedValue({ url: "http://127.0.0.1:9999/db-notebook-mcp", token: "t" });
    isRunningHereMock.mockReturnValue(true);
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    await tracker.trackInvocation("mcpServer", "getDbSchema", {}, async () => "ok");
    await settle();

    const [, mcpServer] = await provider.getChildren();
    const [historyElement] = await provider.getChildren(mcpServer);
    const item = provider.getTreeItem(historyElement);

    expect((item.iconPath as ThemeIcon).id).toBe("symbol-structure");
  });

  it("失敗した呼び出しはdescriptionに「· Error」が付き、アイコンが赤くなる", async () => {
    detectRunningServerMock.mockResolvedValue({ url: "http://127.0.0.1:9999/db-notebook-mcp", token: "t" });
    isRunningHereMock.mockReturnValue(true);
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());

    await expect(
      tracker.trackInvocation("mcpServer", "runDbQuery", {}, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await settle();

    const [, mcpServer] = await provider.getChildren();
    const [historyElement] = await provider.getChildren(mcpServer);
    const item = provider.getTreeItem(historyElement);

    expect(item.description).toMatch(/ · Error$/);
    expect((item.iconPath as ThemeIcon).color).toMatchObject({ id: "charts.red" });

    const tooltip = item.tooltip as { value: string };
    expect(tooltip.value).toContain("boom");
  });

  it("未知のツール名にはデフォルトアイコンが割り当たる", async () => {
    const provider = new providerModule.ToolActivityTreeProvider(makeContext());
    await tracker.trackInvocation("lmTools", "SomeFutureTool", {}, async () => "ok");
    await settle();

    const [lmTools] = await provider.getChildren();
    const [historyElement] = await provider.getChildren(lmTools);
    const item = provider.getTreeItem(historyElement);

    expect((item.iconPath as ThemeIcon).id).toBe("tools");
  });
});

describe("formatClockTime / formatDuration", () => {
  it("formatClockTimeはHH:MM:SS(ローカル時刻)を0埋めで返す", () => {
    const epochMs = new Date(2026, 0, 1, 9, 5, 3).getTime();
    expect(providerModule.formatClockTime(epochMs)).toBe("09:05:03");
  });

  it("formatDurationは1000ms未満をmsec、以上を小数点1桁のsecで返す", () => {
    expect(providerModule.formatDuration(0)).toBe("0msec");
    expect(providerModule.formatDuration(999)).toBe("999msec");
    expect(providerModule.formatDuration(1000)).toBe("1.0sec");
    expect(providerModule.formatDuration(1500)).toBe("1.5sec");
    expect(providerModule.formatDuration(12345)).toBe("12.3sec");
  });
});

describe("describeCategoryStatus", () => {
  it("停止中・待機中・実行中・別ウィンドウ実行中の4パターンを文言化する(呼び出し実績が無い場合)", () => {
    const base: Omit<ToolActivityCategoryElement, "status" | "runningElsewhere"> = {
      kind: "category",
      source: "mcpServer",
      totalCount: 0,
    };
    expect(providerModule.describeCategoryStatus({ ...base, status: "stopped", runningElsewhere: false })).toBe(
      "Stopped"
    );
    expect(providerModule.describeCategoryStatus({ ...base, status: "waiting", runningElsewhere: false })).toBe(
      "Waiting"
    );
    expect(providerModule.describeCategoryStatus({ ...base, status: "running", runningElsewhere: false })).toBe(
      "Running..."
    );
    expect(providerModule.describeCategoryStatus({ ...base, status: "waiting", runningElsewhere: true })).toBe(
      "Running (in another window)"
    );
  });

  it("呼び出し実績があれば件数・最終呼び出し時刻を付与する", () => {
    const lastInvokedAt = new Date(2026, 0, 1, 14, 32, 10).getTime();
    const element: ToolActivityCategoryElement = {
      kind: "category",
      source: "mcpServer",
      status: "waiting",
      runningElsewhere: false,
      totalCount: 5,
      lastInvokedAt,
    };
    expect(providerModule.describeCategoryStatus(element)).toBe("Waiting · 5 calls · last 14:32:10");
  });

  it("停止中でも呼び出し実績(停止前の履歴)があれば件数・最終呼び出し時刻を付与する", () => {
    const lastInvokedAt = new Date(2026, 0, 1, 14, 32, 10).getTime();
    const element: ToolActivityCategoryElement = {
      kind: "category",
      source: "mcpServer",
      status: "stopped",
      runningElsewhere: false,
      totalCount: 3,
      lastInvokedAt,
    };
    expect(providerModule.describeCategoryStatus(element)).toBe("Stopped · 3 calls · last 14:32:10");
  });
});
