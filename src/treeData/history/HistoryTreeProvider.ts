import * as vscode from "vscode";
import dayjs from "dayjs";
import { StateStorage } from "../../utilities/StateStorage";

import { abbr } from "@l-v-yonsama/rdh";
import { QueryHistory } from "../../types/QueryHistory";
import { formatDuration } from "../toolActivity/ToolActivityTreeProvider";
import { averageElapsedTimeMilli } from "../../utilities/queryHistoryUtil";
import { toDynamoDbQueryAnalysisInput } from "../../performanceTuning/preview/dynamoDbQueryAnalysisInput";
import { log } from "../../utilities/logger";
import { QUERY_HISTORY_LABEL_MAX_LENGTH } from "../../constant";
import { RpcInvokeHistory } from "../../types/RpcInvokeHistory";
import { RpcInvokeHistoryStore } from "../../utilities/RpcInvokeHistoryStore";
import { RpcHistoryItem } from "./RpcHistoryTreeItem";

const PREFIX = "[HistoryTreeProvider]";

export type HistorySortOrder = "recent" | "duration";

export const isQueryHistory = (history: QueryHistory | RpcInvokeHistory): history is QueryHistory =>
  "sqlDoc" in history;

export class HistoryTreeProvider implements vscode.TreeDataProvider<QueryHistory | RpcInvokeHistory> {
  private _onDidChangeTreeData: vscode.EventEmitter<QueryHistory | RpcInvokeHistory | undefined | void> =
    new vscode.EventEmitter<QueryHistory | RpcInvokeHistory | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<QueryHistory | RpcInvokeHistory | undefined | void> =
    this._onDidChangeTreeData.event;
  private historyResList: QueryHistory[] = [];
  private rpcHistoryList: RpcInvokeHistory[] = [];
  private refreshVersion = 0;
  private filterConnectionName: string | undefined;
  private sortOrder: HistorySortOrder = "recent";

  constructor(
    context: vscode.ExtensionContext,
    private readonly stateStorage: StateStorage,
    private readonly rpcStore: RpcInvokeHistoryStore
  ) {
    context.subscriptions.push(rpcStore.onDidChange(() => void this.refresh(true)));
    this.init();
  }
  getTreeItem(element: QueryHistory | RpcInvokeHistory): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return isQueryHistory(element) ? new QueryHistoryItem(element) : new RpcHistoryItem(element);
  }
  getChildren(element?: QueryHistory | RpcInvokeHistory): vscode.ProviderResult<Array<QueryHistory | RpcInvokeHistory>> {
    try {
      if (element) {
        return [];
      }
      const list: Array<QueryHistory | RpcInvokeHistory> = [
        ...this.historyResList,
        ...this.rpcHistoryList,
      ].filter((it) => !this.filterConnectionName || it.connectionName === this.filterConnectionName);
      const duration = (it: QueryHistory | RpcInvokeHistory) => isQueryHistory(it)
        ? it.performance?.lastElapsedTimeMilli ?? it.summary?.elapsedTimeMilli ?? -1
        : it.totalElapsedMs;
      const recent = (it: QueryHistory | RpcInvokeHistory) =>
        Math.max(it.executedAt ?? 0, it.lastErrorAt ?? 0);
      list.sort((a, b) => this.sortOrder === "duration"
        ? duration(b) - duration(a)
        : recent(b) - recent(a));
      return Promise.resolve(list);
    } catch (e) {
      console.error(PREFIX, e);
      return Promise.resolve([]);
    }
  }

  getConnectionNames(): string[] {
    return [...new Set([...this.historyResList, ...this.rpcHistoryList].map((it) => it.connectionName))];
  }

  getConnectionFilter(): string | undefined {
    return this.filterConnectionName;
  }

  setConnectionFilter(connectionName: string | undefined): void {
    this.filterConnectionName = connectionName;
    this._onDidChangeTreeData.fire();
  }

  getSortOrder(): HistorySortOrder {
    return this.sortOrder;
  }

  setSortOrder(sortOrder: HistorySortOrder): void {
    this.sortOrder = sortOrder;
    this._onDidChangeTreeData.fire();
  }

  init() {
    setTimeout(() => this.refresh(true), 800);
  }

  async refresh(withSettings = false): Promise<void> {
    log(`${PREFIX} refresh`);
    if (withSettings) {
      const version = ++this.refreshVersion;
      const [queries, rpc] = await Promise.all([
        this.stateStorage.getQueryHistoryList(),
        this.rpcStore.list(),
      ]);
      if (version !== this.refreshVersion) {
        return;
      }
      this.historyResList = queries;
      this.rpcHistoryList = rpc;
    }
    this._onDidChangeTreeData.fire();
  }
}

export class QueryHistoryItem extends vscode.TreeItem {
  constructor(resource: QueryHistory) {
    const isDynamoQuery = resource.request?.kind === "dynamodbQuery";
    const normalizedSqlDoc = resource.sqlDoc.replace(/[ \r\n]+/g, " ").trim();
    super(
      abbr(normalizedSqlDoc, QUERY_HISTORY_LABEL_MAX_LENGTH) || "",
      vscode.TreeItemCollapsibleState.None
    );

    const isDynamoQueryPanelHistory =
      resource.request?.kind === "dynamodbQuery" &&
      resource.request.origin === "dynamoQueryPanel";
    this.contextValue = isDynamoQueryPanelHistory
      ? resource.status === "error"
        ? "queryHistoryDynamoQueryPanelError"
        : "queryHistoryDynamoQueryPanelSuccess"
      : resource.status === "error"
        ? "queryHistoryError"
        : "queryHistorySuccess";

    const descriptionParts = [resource.connectionName];

    if (resource.executedAt) {
      descriptionParts.push(dayjs(resource.executedAt).format("MM/DD HH:mm"));
    }

    if (resource.status === "error") {
      descriptionParts.push("Error");
    } else if (isDynamoQuery) {
      // Native DynamoDB Query results are items, not rows.
      const returnedItemCount =
        resource.summary?.dynamoDb?.returnedItemCount ?? resource.summary?.selectedRows;
      if (returnedItemCount !== undefined) {
        descriptionParts.push(returnedItemCount === 1 ? "1 item" : `${returnedItemCount} items`);
      }
    } else if (resource.meta?.type === "select" && resource.summary?.selectedRows !== undefined) {
      if (resource.summary?.selectedRows === 1) {
        descriptionParts.push(`1 row`);
      } else {
        descriptionParts.push(`${resource.summary?.selectedRows} rows`);
      }
    } else if (resource.meta?.type !== "select" && resource.summary?.affectedRows !== undefined) {
      if (resource.summary?.affectedRows === 1) {
        descriptionParts.push(`1 affected row`);
      } else {
        descriptionParts.push(`${resource.summary?.affectedRows} affected rows`);
      }
    }

    if (resource.performance && resource.performance.sampleCount > 0) {
      const { lastElapsedTimeMilli, sampleCount } = resource.performance;
      const lastElapsed = lastElapsedTimeMilli ?? 0;
      descriptionParts.push(
        sampleCount > 1
          ? `${formatDuration(lastElapsed)} (avg ${formatDuration(
              Math.round(averageElapsedTimeMilli(resource.performance))
            )} x${sampleCount})`
          : formatDuration(lastElapsed)
      );
    }

    if (resource.lastErrorAt) {
      descriptionParts.push(
        `Last retry failed ${dayjs(resource.lastErrorAt).format("MM/DD HH:mm")}`
      );
    }

    this.description = descriptionParts.join(" ・ ");

    if (resource.lastErrorAt) {
      this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
    } else if (resource.status === "error") {
      this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    } else if (resource.status === "success") {
      this.iconPath = new vscode.ThemeIcon("pass");
    }

    // Native Query history uses a value-free description and safe structural JSON.
    const tooltip = new vscode.MarkdownString("", true);
    tooltip.appendCodeblock(resource.sqlDoc, isDynamoQuery ? "text" : "sql");
    if (isDynamoQuery && resource.request?.kind === "dynamodbQuery") {
      try {
        tooltip.appendMarkdown("\n");
        tooltip.appendCodeblock(
          JSON.stringify(toDynamoDbQueryAnalysisInput(resource.request.input), null, 2),
          "json"
        );
      } catch {
        // Malformed/incomplete stored input (should not happen for an entry
        // this feature itself saved) - the sqlDoc text above is still shown.
      }
    }
    if (resource.status === "error" && resource.errorMessage) {
      tooltip.appendMarkdown("\n\n---\n**Error**\n");
      tooltip.appendCodeblock(resource.errorMessage);
    }
    if (resource.lastErrorAt) {
      tooltip.appendMarkdown("\n\n---\n**Last retry failed**\n");
      tooltip.appendCodeblock(resource.lastErrorMessage || "Unknown error");
    }
    if (resource.performance && resource.performance.sampleCount > 0) {
      const { sampleCount, totalElapsedTimeMilli, maxElapsedTimeMilli, lastElapsedTimeMilli } =
        resource.performance;
      tooltip.appendMarkdown(
        `\n\n---\nRan ${sampleCount} times ・ last ${formatDuration(
          lastElapsedTimeMilli ?? 0
        )} ・ total ${formatDuration(totalElapsedTimeMilli)} ・ avg ${formatDuration(
          Math.round(averageElapsedTimeMilli(resource.performance))
        )} ・ max ${formatDuration(maxElapsedTimeMilli ?? 0)}`
      );
    }
    if (resource.performance?.statisticsSince) {
      tooltip.appendMarkdown(
        `\n\nMeasurement period started ${dayjs(resource.performance.statisticsSince).format("YYYY-MM-DD HH:mm:ss")}`
      );
    }
    tooltip.appendMarkdown(
      "\n\n---\n💡 Tip: Cmd/Ctrl+Click to select multiple entries, then right-click for bulk actions."
    );
    tooltip.isTrusted = true;

    this.tooltip = tooltip;
  }
}
