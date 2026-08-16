import * as vscode from "vscode";
import dayjs from "dayjs";
import { StateStorage } from "../../utilities/StateStorage";

import { abbr } from "@l-v-yonsama/rdh";
import { SQLHistory } from "../../types/SQLHistory";
import { formatDuration } from "../toolActivity/ToolActivityTreeProvider";
import { averageElapsedTimeMilli } from "../../utilities/sqlHistoryUtil";
import { log } from "../../utilities/logger";

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
    super(
      abbr(resource.sqlDoc.replace(/[ \r\n]+/g, " ").trim(), 40) || "",
      vscode.TreeItemCollapsibleState.None
    );

    this.contextValue = resource.status === "error" ? "sqlHistoryError" : "sqlHistorySuccess";

    const descriptionParts = [resource.connectionName];

    if (resource.executedAt) {
      descriptionParts.push(dayjs(resource.executedAt).format("MM/DD HH:mm"));
    }

    if (resource.status === "error") {
      descriptionParts.push("Error");
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
      descriptionParts.push(
        sampleCount > 1
          ? `${formatDuration(lastElapsedTimeMilli)} (avg ${formatDuration(
              Math.round(averageElapsedTimeMilli(resource.performance))
            )} x${sampleCount})`
          : formatDuration(lastElapsedTimeMilli)
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

    let tooltipMarkdown = "```sql\n" + resource.sqlDoc + "\n```";
    if (resource.status === "error" && resource.errorMessage) {
      tooltipMarkdown += "\n\n---\n**Error**\n```\n" + resource.errorMessage + "\n```";
    }
    if (resource.lastErrorAt) {
      tooltipMarkdown +=
        "\n\n---\n**Last retry failed**\n```\n" +
        (resource.lastErrorMessage || "Unknown error") +
        "\n```";
    }
    if (resource.performance && resource.performance.sampleCount > 0) {
      const { sampleCount, totalElapsedTimeMilli, maxElapsedTimeMilli, lastElapsedTimeMilli } =
        resource.performance;
      tooltipMarkdown += `\n\n---\nRan ${sampleCount} times ・ last ${formatDuration(
        lastElapsedTimeMilli
      )} ・ total ${formatDuration(totalElapsedTimeMilli)} ・ avg ${formatDuration(
        Math.round(averageElapsedTimeMilli(resource.performance))
      )} ・ max ${formatDuration(maxElapsedTimeMilli)}`;
    }
    tooltipMarkdown +=
      "\n\n---\n💡 Tip: Cmd/Ctrl+Click to select multiple entries, then right-click for bulk actions.";

    const tooltip = new vscode.MarkdownString(encodeHtmlWeak(tooltipMarkdown), true);
    tooltip.isTrusted = true;

    this.tooltip = tooltip;
  }
}

export function encodeHtmlWeak(s: string | undefined): string | undefined {
  return s?.replace(/[<>&"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}
