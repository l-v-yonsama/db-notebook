import * as vscode from "vscode";
import * as path from "path";
import { StateStorage } from "../utilities/StateStorage";
import {
  DBType,
  DbColumn,
  DbConnection,
  DbResource,
  RedisDatabase,
  ResourceType,
  isArray,
  isBinaryLike,
  isBooleanLike,
  isDateTimeOrDateOrTime,
  isEnumOrSet,
  isJsonLike,
  isNumericLike,
  isTextLike,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { mediaDir } from "../constant";
import { log } from "../utilities/logger";

const PREFIX = "[ResourceTreeProvider]";

export class ResourceTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> =
    new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> =
    this._onDidChangeTreeData.event;
  private conResList: DbConnection[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    this.init();
  }

  init() {
    setTimeout(() => this.refresh(true), 1000);
  }

  async refresh(withSettings = false): Promise<void> {
    log(`${PREFIX} refresh`);
    if (withSettings) {
      this.conResList.splice(0, this.conResList.length);
      const settings = await this.stateStorage.getConnectionSettingList();
      for (const setting of settings) {
        const conRes = new DbConnection(setting);
        this.conResList.push(conRes);
      }
    }
    this._onDidChangeTreeData.fire();
  }

  changeConnectionTreeData(conRes: DbConnection): void {
    log(`${PREFIX} changeConnectionTreeData conRes.password=` + conRes.password);
    this._onDidChangeTreeData.fire(conRes);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DbResource): vscode.TreeItem {
    let state = vscode.TreeItemCollapsibleState.None;
    if (element.resourceType === ResourceType.Connection) {
      // connection
      const dbDatabase = this.stateStorage.getResourceByName(element.name);
      if (dbDatabase) {
        state = vscode.TreeItemCollapsibleState.Collapsed;
      }
      return new ConnectionListItem(element as DbConnection, state);
    }
    if (element.hasChildren()) {
      state = vscode.TreeItemCollapsibleState.Collapsed;
    }
    return new DBDatabaseItem(element, state, this.stateStorage);
  }

  getChildren(element?: DbResource): vscode.ProviderResult<DbResource[]> {
    try {
      if (element) {
        if (element.resourceType === ResourceType.Connection) {
          const dbDatabase = this.stateStorage.getResourceByName(element.name);
          return Promise.resolve(dbDatabase ?? []);
        }
        return Promise.resolve(element.children);
      }
      // connection resource
      return Promise.resolve(this.conResList);
    } catch (e) {
      console.error(e);
      return Promise.resolve([]);
    }
  }
}

export class ConnectionListItem extends vscode.TreeItem {
  constructor(public readonly conRes: DbConnection, state: vscode.TreeItemCollapsibleState) {
    super(conRes.name, state);

    if (conRes.isInProgress) {
      this.iconPath = new vscode.ThemeIcon("loading~spin");
    } else {
      this.iconPath = {
        dark: path.join(mediaDir, "dark", "debug-disconnect.svg"),
        light: path.join(mediaDir, "light", "debug-disconnect.svg"),
      };
    }
    this.description = `(${conRes.dbType})`;
    this.contextValue = `${conRes.resourceType},dbType:${conRes.dbType},${conRes.isInProgress}`;
  }
}

export class DBDatabaseItem extends vscode.TreeItem {
  constructor(
    public readonly resource: DbResource,
    state: vscode.TreeItemCollapsibleState,
    private stateStorage: StateStorage
  ) {
    super(resource.name, state);

    let iconFile = "database.svg";
    let description = resource.comment || "";
    let scannable = false;
    let tooltip: string | vscode.MarkdownString | undefined;

    switch (resource.resourceType) {
      case ResourceType.RdsDatabase:
        iconFile = "database.svg";
        break;
      case ResourceType.AwsDatabase:
        iconFile = "database.svg";
        break;
      case ResourceType.RedisDatabase:
        iconFile = "database.svg";
        description = `${(resource as RedisDatabase).numOfKeys} keys`;
        scannable = true;

        break;
      case ResourceType.Schema:
      case ResourceType.Owner:
        iconFile = "account.svg";
        break;
      case ResourceType.Bucket:
        iconFile = "build.svg";
        scannable = true;
        break;
      case ResourceType.Queue:
        iconFile = "git-commit.svg";
        scannable = true;
        break;
      case ResourceType.Table:
        iconFile = "output.svg";
        break;
      case ResourceType.LogGroup:
        iconFile = "list-ordered.svg";
        scannable = true;
        break;
      case ResourceType.Column:
        {
          const c = resource as DbColumn;
          iconFile = "circle-outline.svg";
          if (isNumericLike(c.colType)) {
            iconFile = "symbol-numeric.svg";
          } else if (isDateTimeOrDateOrTime(c.colType)) {
            iconFile = "calendar.svg";
          } else if (isArray(c.colType)) {
            iconFile = "symbol-array.svg";
          } else if (isBinaryLike(c.colType)) {
            iconFile = "file-binary.svg";
          } else if (isBooleanLike(c.colType)) {
            iconFile = "symbol-boolean.svg";
          } else if (isEnumOrSet(c.colType)) {
            iconFile = "symbol-enum.svg";
          } else if (isJsonLike(c.colType)) {
            iconFile = "json.svg";
          } else if (isTextLike(c.colType)) {
            iconFile = "symbol-string.svg";
          }
          tooltip = new vscode.MarkdownString(encodeHtmlWeak(c.name), true);
          tooltip.supportHtml = true;
          tooltip.isTrusted = true;
          tooltip.appendMarkdown(`\\\n${c.nullable ? "NULLABLE" : "NOT NULL"}`);
          if (c.comment) {
            tooltip.appendMarkdown(`\\\n${encodeHtmlWeak(c.comment)}`);
          }
          tooltip.appendMarkdown("\\\nTo know more, click '$(info)' icon.");
        }
        break;
    }
    this.iconPath = {
      dark: path.join(mediaDir, "dark", iconFile),
      light: path.join(mediaDir, "light", iconFile),
    };

    this.description = description;
    let contextValue = resource.resourceType;

    contextValue += ",properties";
    if (scannable) {
      contextValue += ",scannable";
    }
    if (tooltip) {
      this.tooltip = tooltip;
    }
    this.contextValue = contextValue;
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