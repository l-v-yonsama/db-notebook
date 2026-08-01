import {
  Event,
  EventEmitter,
  ExtensionContext,
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import { SHOW_INVOCATION_LOG } from "../constant";
import { isRunningHere } from "../mcpServer/server";
import { detectRunningServer } from "../mcpServer/singleton";
import { getHistory, getTotalCount, isActive, ToolInvocationRecord, ToolSource } from "./ToolInvocationTracker";

type CategoryStatus = "stopped" | "waiting" | "running";

export type ToolActivityCategoryElement = {
  kind: "category";
  source: ToolSource;
  status: CategoryStatus;
  /** MCP Server only: the lock file says a server is up, but not one this window started. */
  runningElsewhere: boolean;
  /** MCP Server only, populated whenever a server is detected (even if running elsewhere). */
  serverUrl?: string;
  /** Lifetime count for this source, independent of history's 10-item cap. */
  totalCount: number;
  /** `startedAt` of the newest history entry, if any -- so "did something just happen" survives even when the transient Running state itself flashes by too fast to see. */
  lastInvokedAt?: number;
};

export type ToolActivityHistoryElement = {
  kind: "history";
  record: ToolInvocationRecord;
};

export type ToolActivityElement = ToolActivityCategoryElement | ToolActivityHistoryElement;

const CATEGORY_LABEL: Record<ToolSource, string> = {
  lmTools: "LM Tools",
  mcpServer: "MCP Server",
};

// Reuses the icons already assigned to these tools in package.json's languageModelTools
// contribution, so the same tool looks the same whether it ran via Copilot or MCP.
const TOOL_ICON_BY_NAME: Record<string, string> = {
  ListConnectionsTool: "list-unordered",
  listDbConnections: "list-unordered",
  GetSchemaTool: "symbol-structure",
  getDbSchema: "symbol-structure",
  TestConnectionTool: "plug",
  testDbConnection: "plug",
  RunQueryTool: "play",
  runDbQuery: "play",
  ScanResourceTool: "search",
  scanDbResource: "search",
  RunTransactionTool: "run-all",
  runDbTransaction: "run-all",
  CreateNotebookTool: "notebook",
  EditNotebookTool: "edit",
};
const DEFAULT_TOOL_ICON = "tools";

export class ToolActivityTreeProvider implements TreeDataProvider<ToolActivityElement> {
  private _onDidChangeTreeData = new EventEmitter<void>();
  readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event;

  constructor(private readonly context: ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ToolActivityElement): TreeItem {
    return element.kind === "category" ? buildCategoryItem(element) : buildHistoryItem(element);
  }

  async getChildren(element?: ToolActivityElement): Promise<ToolActivityElement[]> {
    if (!element) {
      return this.getRootElements();
    }
    if (element.kind === "history") {
      return [];
    }
    if (element.source === "mcpServer" && (element.status === "stopped" || element.runningElsewhere)) {
      return [];
    }
    return getHistory(element.source).map((record) => ({ kind: "history" as const, record }));
  }

  private async getRootElements(): Promise<ToolActivityCategoryElement[]> {
    // Read-only status check (lock file + a live health check), so this reflects reality
    // even when another VS Code window is the one actually running the server. See
    // singleton.ts's own doc comment for why acquireOrDetect must NOT be used here.
    const running = await detectRunningServer(this.context);
    const runningElsewhere = !!running && !isRunningHere();

    const lmTools: ToolActivityCategoryElement = {
      kind: "category",
      source: "lmTools",
      status: isActive("lmTools") ? "running" : "waiting",
      runningElsewhere: false,
      totalCount: getTotalCount("lmTools"),
      lastInvokedAt: getHistory("lmTools")[0]?.startedAt,
    };

    const mcpServer: ToolActivityCategoryElement = {
      kind: "category",
      source: "mcpServer",
      status: !running ? "stopped" : isActive("mcpServer") ? "running" : "waiting",
      runningElsewhere,
      serverUrl: running?.url,
      totalCount: getTotalCount("mcpServer"),
      lastInvokedAt: getHistory("mcpServer")[0]?.startedAt,
    };

    return [lmTools, mcpServer];
  }
}

export function describeCategoryStatus(element: ToolActivityCategoryElement): string {
  return `${describeCategoryState(element)}${describeActivitySummary(element)}`;
}

function describeCategoryState(element: ToolActivityCategoryElement): string {
  if (element.status === "stopped") {
    return "Stopped";
  }
  // Our activity counter only observes requests this process itself handled, so a
  // server running in another window always looks idle to us -- say so explicitly
  // rather than showing a misleading "Waiting".
  if (element.runningElsewhere) {
    return "Running (in another window)";
  }
  return element.status === "running" ? "Running..." : "Waiting";
}

/**
 * A transient "Running..." can flash by too fast to see for a fast call (see
 * MIN_VISIBLE_RUNNING_MS's doc comment) -- this survives that flash so "did anything
 * happen" is still answerable by glancing at the tree later. Absolute clock time, not
 * relative ("3s ago"), so it stays accurate without a refresh poll loop (this view
 * deliberately has none -- see the plan's "3 refresh paths, no polling" design).
 */
function describeActivitySummary(element: ToolActivityCategoryElement): string {
  if (element.totalCount === 0) {
    return "";
  }
  const callWord = element.totalCount === 1 ? "call" : "calls";
  const lastInvoked = element.lastInvokedAt !== undefined ? ` · last ${formatClockTime(element.lastInvokedAt)}` : "";
  return ` · ${element.totalCount} ${callWord}${lastInvoked}`;
}

function categoryIcon(status: CategoryStatus): ThemeIcon {
  if (status === "stopped") {
    return new ThemeIcon("circle-outline");
  }
  if (status === "running") {
    return new ThemeIcon("loading~spin", new ThemeColor("charts.blue"));
  }
  return new ThemeIcon("circle-filled", new ThemeColor("charts.green"));
}

function buildCategoryItem(element: ToolActivityCategoryElement): TreeItem {
  const item = new TreeItem(CATEGORY_LABEL[element.source], TreeItemCollapsibleState.Expanded);
  item.description = describeCategoryStatus(element);
  item.iconPath = categoryIcon(element.status);
  item.tooltip = buildCategoryTooltip(element);

  if (element.source === "lmTools") {
    item.contextValue = "toolActivityCategory,lmTools";
  } else {
    const lifecycleToken = element.status === "stopped" ? "stopped" : "running";
    item.contextValue = `toolActivityCategory,mcpServer,${lifecycleToken}`;
  }
  // Only offer "clear history" once there's something to clear.
  if (element.totalCount > 0) {
    item.contextValue += ",hasHistory";
  }
  return item;
}

function buildCategoryTooltip(element: ToolActivityCategoryElement): MarkdownString {
  const lines = [`Source: ${element.source}`, `Status: ${describeCategoryStatus(element)}`];
  if (element.serverUrl) {
    lines.push(`URL: ${element.serverUrl}`);
  }
  return new MarkdownString("```\n" + lines.join("\n") + "\n```");
}

function buildHistoryItem(element: ToolActivityHistoryElement): TreeItem {
  const { record } = element;
  const item = new TreeItem(record.toolName, TreeItemCollapsibleState.None);

  const errorSuffix = record.status === "error" ? " · Error" : "";
  item.description = `${formatClockTime(record.startedAt)} (${formatDuration(record.durationMs)})${errorSuffix}`;

  const iconId = TOOL_ICON_BY_NAME[record.toolName] ?? DEFAULT_TOOL_ICON;
  item.iconPath = new ThemeIcon(iconId, record.status === "error" ? new ThemeColor("charts.red") : undefined);

  item.contextValue = "toolActivityHistory";
  item.tooltip = buildHistoryTooltip(record);
  item.command = {
    command: SHOW_INVOCATION_LOG,
    title: "Show Invocation Log",
    arguments: [record],
  };
  return item;
}

function buildHistoryTooltip(record: ToolInvocationRecord): MarkdownString {
  const lines = [
    `Tool: ${record.toolName}`,
    `Source: ${record.source}`,
    `Started: ${new Date(record.startedAt).toLocaleString()}`,
    `Duration: ${record.durationMs}ms`,
    `Status: ${record.status}`,
    "",
    "Input:",
    record.inputSummary,
    "",
    record.status === "error" ? "Error:" : "Output:",
    record.outputSummary,
  ];
  return new MarkdownString("```\n" + lines.join("\n") + "\n```");
}

export function formatClockTime(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}msec`;
  }
  return `${(durationMs / 1000).toFixed(1)}sec`;
}
