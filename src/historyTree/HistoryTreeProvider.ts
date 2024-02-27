import * as vscode from "vscode";
import { StateStorage } from "../utilities/StateStorage";

import { log } from "../utilities/logger";
import { SQLHistory } from "../types/SQLHistory";
import { abbr } from "@l-v-yonsama/multi-platform-database-drivers";

const PREFIX = "[HistoryTreeProvider]";

export class HistoryTreeProvider implements vscode.TreeDataProvider<SQLHistory> {
  private _onDidChangeTreeData: vscode.EventEmitter<SQLHistory | undefined | void> =
    new vscode.EventEmitter<SQLHistory | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SQLHistory | undefined | void> =
    this._onDidChangeTreeData.event;
  private historyResList: SQLHistory[] = [];

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
      return Promise.resolve(this.historyResList);
    } catch (e) {
      console.error(e);
      return Promise.resolve([]);
    }
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

    let description = resource.connectionName;
    if (resource.meta?.type === "select" && resource.summary?.selectedRows !== undefined) {
      if (resource.summary?.selectedRows === 1) {
        description += ` (1 row)`;
      } else {
        description += ` (${resource.summary?.selectedRows} rows)`;
      }
    } else if (resource.meta?.type !== "select" && resource.summary?.affectedRows !== undefined) {
      if (resource.summary?.affectedRows === 1) {
        description += ` (1 affected row)`;
      } else {
        description += ` (${resource.summary?.affectedRows} affected rows)`;
      }
    }
    let tooltip: string | vscode.MarkdownString | undefined;

    tooltip = new vscode.MarkdownString(
      encodeHtmlWeak("```sql\n" + resource.sqlDoc + "\n```"),
      true
    );
    tooltip.isTrusted = true;

    this.description = description;

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
