import {
  DbColumn,
  DbConnection,
  DbDynamoTable,
  DbDynamoTableColumn,
  DbResource,
  DbSubscription,
  DBType,
  IamClient,
  MqttDatabase,
  parseDynamoAttrType,
  RdsDatabase,
  RedisDatabase,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  GeneralColumnType,
  isArray,
  isBinaryLike,
  isBooleanLike,
  isDateTimeOrDateOrTime,
  isEnumOrSet,
  isJsonLike,
  isNumericLike,
  isTextLike,
} from "@l-v-yonsama/rdh";
import * as vscode from "vscode";
import { SHOW_CONNECTION_SETTING, SHOW_RESOURCE_PROPERTIES } from "../constant";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "[ResourceTreeProvider]";

const toIconFileName = (colType: GeneralColumnType): string => {
  let iconFile = "circle-outline";
  if (isNumericLike(colType)) {
    iconFile = "symbol-numeric";
  } else if (isDateTimeOrDateOrTime(colType)) {
    iconFile = "calendar";
  } else if (isArray(colType)) {
    iconFile = "symbol-array";
  } else if (isBinaryLike(colType)) {
    iconFile = "file-binary";
  } else if (isBooleanLike(colType)) {
    iconFile = "symbol-boolean";
  } else if (isEnumOrSet(colType)) {
    iconFile = "symbol-constant";
  } else if (isJsonLike(colType)) {
    iconFile = "json";
  } else if (isTextLike(colType)) {
    iconFile = "symbol-string";
  }
  return iconFile;
};

let defaultConName = "";

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
    this.resetDefaultConnectionName();
    this._onDidChangeTreeData.fire();
  }

  async resetDefaultConnectionName(): Promise<void> {
    defaultConName = this.stateStorage.getDefaultConnectionName();
  }

  changeConnectionTreeData(conRes: DbConnection): void {
    this.resetDefaultConnectionName();
    this._onDidChangeTreeData.fire(conRes);
    this._onDidChangeTreeData.fire();
  }

  changeDbResourceTreeData(dbRes: DbResource): void {
    this._onDidChangeTreeData.fire(dbRes);
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
      if (conRes.name === defaultConName) {
        this.iconPath = new vscode.ThemeIcon(
          "debug-disconnect",
          new vscode.ThemeColor("errorForeground")
        );
      } else {
        if (conRes.isConnected) {
          this.iconPath = new vscode.ThemeIcon("pass");
        } else {
          this.iconPath = new vscode.ThemeIcon("debug-disconnect");
        }
      }
    }
    const clearableDefault = conRes.name === defaultConName;
    this.description = `(${conRes.dbType})`;
    if (conRes.dbType === DBType.Mqtt) {
      this.description += ` (${conRes.isConnected ? "connected" : "disconnected"})`;
    }
    const support = DBType.Mqtt !== conRes.dbType;
    this.contextValue = `${conRes.resourceType},dbType:${conRes.dbType},CD:${clearableDefault},connected:${conRes.isConnected},support:${support},${conRes.isInProgress}`;

    this.command = {
      title: "Show resource property",
      command: SHOW_CONNECTION_SETTING,
      arguments: [conRes],
    };
  }
}

export class DBDatabaseItem extends vscode.TreeItem {
  constructor(
    public readonly resource: DbResource,
    state: vscode.TreeItemCollapsibleState,
    private stateStorage: StateStorage
  ) {
    super(resource.name, state);

    let iconPath = new vscode.ThemeIcon("database");
    let description = resource.comment || "";
    let scannable = false;
    let showSessions = false;
    let tooltip: string | vscode.MarkdownString | undefined;

    switch (resource.resourceType) {
      case ResourceType.RdsDatabase:
        {
          const res = resource as RdsDatabase;
          iconPath = new vscode.ThemeIcon("database");
          const { dbType } = res.meta;
          if (
            dbType === DBType.MySQL ||
            dbType === DBType.Postgres ||
            dbType === DBType.SQLServer
          ) {
            showSessions = true;
          }
        }
        break;
      case ResourceType.AwsDatabase:
        iconPath = new vscode.ThemeIcon("database");
        break;
      case ResourceType.KeycloakDatabase:
        iconPath = new vscode.ThemeIcon("database");
        break;
      case ResourceType.Auth0Database:
        iconPath = new vscode.ThemeIcon("database");
        scannable = true;
        break;
      case ResourceType.RedisDatabase:
        {
          const res = resource as RedisDatabase;
          iconPath = new vscode.ThemeIcon("database");
          description = `${res.numOfKeys} keys`;
          scannable = true;
        }
        break;
      case ResourceType.MqttDatabase:
        {
          const res = resource as MqttDatabase;
          iconPath = new vscode.ThemeIcon("database");
          scannable = false;
        }
        break;
      case ResourceType.Schema:
      case ResourceType.Owner:
        iconPath = new vscode.ThemeIcon("account");
        break;
      case ResourceType.Bucket:
        iconPath = new vscode.ThemeIcon("package");
        scannable = true;
        break;
      case ResourceType.Queue:
        iconPath = new vscode.ThemeIcon("git-commit");
        scannable = true;
        break;
      case ResourceType.Table:
        iconPath = new vscode.ThemeIcon("table");
        break;
      case ResourceType.DynamoTable:
        iconPath = new vscode.ThemeIcon("table");
        {
          const dynamoTable = resource as DbDynamoTable;
          if (dynamoTable.attr?.ItemCount === 1) {
            description += ` 1 item`;
          } else {
            if (dynamoTable.attr?.ItemCount === 0) {
              description += ` No items`;
            } else {
              description += ` ${dynamoTable.attr?.ItemCount} items`;
            }
          }
        }
        break;
      case ResourceType.Subscription:
        {
          const subscriptionRes = resource as DbSubscription;
          if (subscriptionRes.isSubscribed) {
            let numOfPayloads = subscriptionRes.meta?.numOfPayloads ?? 0;
            iconPath = new vscode.ThemeIcon("pass");
            description = ` ${numOfPayloads} payloads`;
          } else {
            iconPath = new vscode.ThemeIcon("output");
            description = `(unsubscribed)`;
          }
        }
        break;
      case ResourceType.LogGroup:
        iconPath = new vscode.ThemeIcon("list-ordered");
        scannable = true;
        break;
      case ResourceType.IamClient:
        {
          iconPath = new vscode.ThemeIcon("hubot");
          const client = resource as IamClient;
          if (client.meta?.scannable) {
            // Keycloak
            scannable = true;
          } else {
            // Auth0
          }
          if (client.numOfUserSessions !== undefined) {
            description += ` userSessions:${client.numOfUserSessions}`;
          }
          if (client.numOfOfflineSessions !== undefined) {
            description += ` offlineSessions:${client.numOfOfflineSessions}`;
          }
        }
        break;
      case ResourceType.IamRealm:
        iconPath = new vscode.ThemeIcon("inbox");
        scannable = true;
        break;
      case ResourceType.IamGroup:
        iconPath = new vscode.ThemeIcon("activate-breakpoints");
        // for Keycloak's group.
        // can't search by keyword.
        // scannable = true;
        break;
      case ResourceType.IamOrganization:
        iconPath = new vscode.ThemeIcon("organization");
        // for Auth0's group.
        scannable = true;
        break;
      case ResourceType.DynamoColumn:
        {
          const c = resource as DbDynamoTableColumn;
          iconPath = new vscode.ThemeIcon(toIconFileName(parseDynamoAttrType(c.attrType)));
          tooltip = new vscode.MarkdownString(encodeHtmlWeak(c.name), true);
          tooltip.supportHtml = true;
          tooltip.isTrusted = true;
          if (c.pk) {
            description = "(pk)";
            tooltip.appendMarkdown(`\\\nPARTIAL KEY`);
          }
          if (c.sk) {
            description = "(sk)";
            tooltip.appendMarkdown(`\\\nSORT KEY`);
          }
          tooltip.appendMarkdown("\\\nTo know more, click '$(info)' icon.");
        }
        break;
      case ResourceType.Column:
        {
          const c = resource as DbColumn;
          iconPath = new vscode.ThemeIcon(toIconFileName(c.colType));
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
    this.iconPath = iconPath;

    this.description = description;
    let contextValue = resource.resourceType;

    if (resource.resourceType === ResourceType.Subscription) {
      const subscription = resource as DbSubscription;
      contextValue += `,isSubscribed=${subscription.isSubscribed}`;
    }
    contextValue += ",properties";
    if (showSessions) {
      contextValue += ",showSessions";
    }
    if (scannable) {
      contextValue += ",scannable";
    }

    if (tooltip) {
      this.tooltip = tooltip;
    }

    this.contextValue = contextValue;
    this.command = {
      title: "Show resource property",
      command: SHOW_RESOURCE_PROPERTIES,
      arguments: [resource],
    };
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
