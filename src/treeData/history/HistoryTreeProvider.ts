import * as vscode from "vscode";
import dayjs from "dayjs";
import { StateStorage } from "../../utilities/StateStorage";

import { abbr } from "@l-v-yonsama/rdh";
import { SQLHistory } from "../../types/SQLHistory";
import { formatDuration } from "../toolActivity/ToolActivityTreeProvider";
import { averageElapsedTimeMilli } from "../../utilities/sqlHistoryUtil";
import { toDynamoDbQueryAnalysisInput } from "../../utilities/dynamoDbQueryAnalysisInput";
import { log } from "../../utilities/logger";
import { SQL_HISTORY_LABEL_MAX_LENGTH } from "../../constant";

const PREFIX = "[HistoryTreeProvider]";

export type SQLHistorySortOrder = "recent" | "duration";

export class HistoryTreeProvider implements vscode.TreeDataProvider<SQLHistory> {
  private _onDidChangeTreeData: vscode.EventEmitter<SQLHistory | undefined | void> =
    new vscode.EventEmitter<SQLHistory | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SQLHistory | undefined | void> =
    this._onDidChangeTreeData.event;
  private historyResList: SQLHistory[] = [];
  private filterConnectionName: string | undefined;
  private sortOrder: SQLHistorySortOrder = "recent";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    this.init();
  }
  getTreeItem(element: SQLHistory): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return new SQLHistoryItem(element);
  }
  getChildren(element?: SQLHistory | undefined): vscode.ProviderResult<SQLHistory[]> {
    try {
      let list = this.filterConnectionName
        ? this.historyResList.filter((it) => it.connectionName === this.filterConnectionName)
        : [...this.historyResList];
      if (this.sortOrder === "duration") {
        list = list.sort(
          (a, b) =>
            (b.performance?.lastElapsedTimeMilli ?? 0) - (a.performance?.lastElapsedTimeMilli ?? 0)
        );
      }
      return Promise.resolve(list);
    } catch (e) {
      console.error(PREFIX, e);
      return Promise.resolve([]);
    }
  }

  getConnectionNames(): string[] {
    return [...new Set(this.historyResList.map((it) => it.connectionName))];
  }

  getConnectionFilter(): string | undefined {
    return this.filterConnectionName;
  }

  setConnectionFilter(connectionName: string | undefined): void {
    this.filterConnectionName = connectionName;
    this._onDidChangeTreeData.fire();
  }

  getSortOrder(): SQLHistorySortOrder {
    return this.sortOrder;
  }

  setSortOrder(sortOrder: SQLHistorySortOrder): void {
    this.sortOrder = sortOrder;
    this._onDidChangeTreeData.fire();
  }

  init() {
    setTimeout(() => this.refresh(true), 800);
  }

  async refresh(withSettings = false): Promise<void> {
    log(`${PREFIX} refresh`);
    if (withSettings) {
      this.historyResList.splice(0, this.historyResList.length);
      const histories = await this.stateStorage.getSQLHistoryList();
      for (const history of histories) {
        this.historyResList.push(history);
      }
    }
    this._onDidChangeTreeData.fire();
  }
}

export class SQLHistoryItem extends vscode.TreeItem {
  constructor(resource: SQLHistory) {
    const isDynamoQuery = resource.request?.kind === "dynamodbQuery";
    const normalizedSqlDoc = resource.sqlDoc.replace(/[ \r\n]+/g, " ").trim();
    super(
      abbr(normalizedSqlDoc, SQL_HISTORY_LABEL_MAX_LENGTH) || "",
      vscode.TreeItemCollapsibleState.None
    );

    const isDynamoQueryPanelHistory =
      resource.request?.kind === "dynamodbQuery" &&
      resource.request.origin === "dynamoQueryPanel";
    this.contextValue = isDynamoQueryPanelHistory
      ? resource.status === "error"
        ? "sqlHistoryDynamoQueryPanelError"
        : "sqlHistoryDynamoQueryPanelSuccess"
      : resource.status === "error"
        ? "sqlHistoryError"
        : "sqlHistorySuccess";

    const descriptionParts = [resource.connectionName];

    if (resource.executedAt) {
      descriptionParts.push(dayjs(resource.executedAt).format("MM/DD HH:mm"));
    }

    if (resource.status === "error") {
      descriptionParts.push("Error");
    } else if (isDynamoQuery) {
      // native Query results are "items", never "rows" (design doc §8.1) -
      // DynamoDB's own vocabulary, and distinct from the generic RDH row
      // count SQL/PartiQL history already shows above.
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

    // native Query history's sqlDoc is a value-free description text, not
    // SQL - an ```sql fence would mislabel it (design doc §8.1). Its
    // structural (values-free) query shape is shown as JSON underneath
    // instead of the raw request, which would leak ExpressionAttributeValues
    // into the tooltip (design doc §4.2).
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
