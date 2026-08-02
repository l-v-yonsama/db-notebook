import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vscode";
import type { ExtensionContext } from "vscode";
import { CLEAR_TOOL_ACTIVITY_HISTORY, SHOW_INVOCATION_LOG } from "../../../src/constant";
import { registerToolActivityTreeCommand } from "../../../src/treeData/toolActivity/ToolActivityTreeCommand";
import type { ToolActivityCategoryElement } from "../../../src/treeData/toolActivity/ToolActivityTreeProvider";
import type { ToolInvocationRecord } from "../../../src/treeData/toolActivity/ToolInvocationTracker";

const { logMock, showMock, clearHistoryMock } = vi.hoisted(() => ({
  logMock: vi.fn(),
  showMock: vi.fn(),
  clearHistoryMock: vi.fn(),
}));

vi.mock("../../../src/utilities/logger", () => ({
  log: logMock,
  show: showMock,
}));

vi.mock("../../../src/treeData/toolActivity/ToolInvocationTracker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/treeData/toolActivity/ToolInvocationTracker")>();
  return { ...actual, clearHistory: clearHistoryMock };
});

const makeContext = (): ExtensionContext => ({ subscriptions: [] }) as unknown as ExtensionContext;

const sampleRecord: ToolInvocationRecord = {
  id: "1",
  source: "lmTools",
  toolName: "GetSchemaTool",
  startedAt: Date.now(),
  durationMs: 12,
  status: "success",
  inputSummary: '{"connectionName":"db1"}',
  outputSummary: "CREATE TABLE t(id int)",
};

const getHandlerFor = (command: string): ((...args: unknown[]) => void) => {
  const call = vi.mocked(commands.registerCommand).mock.calls.find(([c]) => c === command);
  if (!call) {
    throw new Error(`command not registered: ${command}`);
  }
  return call[1] as (...args: unknown[]) => void;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerToolActivityTreeCommand", () => {
  it("show-invocation-log / clear-history の両方を登録し、disposableをcontext.subscriptionsに積む", () => {
    const context = makeContext();
    registerToolActivityTreeCommand(context);

    expect(commands.registerCommand).toHaveBeenCalledWith(SHOW_INVOCATION_LOG, expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith(CLEAR_TOOL_ACTIVITY_HISTORY, expect.any(Function));
    expect(context.subscriptions).toHaveLength(2);
  });

  describe(SHOW_INVOCATION_LOG, () => {
    it("レコード付きで呼ばれるとツール名・入力・出力をログし、出力チャネルをpreserveFocus付きで表示する", () => {
      registerToolActivityTreeCommand(makeContext());
      const handler = getHandlerFor(SHOW_INVOCATION_LOG);

      handler(sampleRecord);

      expect(logMock).toHaveBeenCalledTimes(1);
      const [loggedText] = logMock.mock.calls[0];
      expect(loggedText).toContain("GetSchemaTool");
      expect(loggedText).toContain("connectionName");
      expect(loggedText).toContain("CREATE TABLE");
      expect(showMock).toHaveBeenCalledWith(true);
    });

    it("レコード無しで呼ばれた場合は何もしない", () => {
      registerToolActivityTreeCommand(makeContext());
      const handler = getHandlerFor(SHOW_INVOCATION_LOG);

      handler(undefined);

      expect(logMock).not.toHaveBeenCalled();
      expect(showMock).not.toHaveBeenCalled();
    });
  });

  describe(CLEAR_TOOL_ACTIVITY_HISTORY, () => {
    const categoryElement: ToolActivityCategoryElement = {
      kind: "category",
      source: "mcpServer",
      status: "waiting",
      runningElsewhere: false,
      totalCount: 3,
    };

    it("カテゴリ要素付きで呼ばれると、そのsourceのTracker.clearHistoryを呼ぶ", () => {
      registerToolActivityTreeCommand(makeContext());
      const handler = getHandlerFor(CLEAR_TOOL_ACTIVITY_HISTORY);

      handler(categoryElement);

      expect(clearHistoryMock).toHaveBeenCalledWith("mcpServer");
    });

    it("要素無しで呼ばれた場合は何もしない", () => {
      registerToolActivityTreeCommand(makeContext());
      const handler = getHandlerFor(CLEAR_TOOL_ACTIVITY_HISTORY);

      handler(undefined);

      expect(clearHistoryMock).not.toHaveBeenCalled();
    });
  });
});
