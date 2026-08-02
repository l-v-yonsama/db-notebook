import {
  AwsDatabase,
  AwsServiceType,
  ConnectionEnvironment,
  DbColumn,
  DbConnection,
  DbDynamoTable,
  DbDynamoTableColumn,
  DbResource,
  DbSubscription,
  DbTable,
  DBType,
  IamClient,
  isRDSType,
  MemcacheDatabase,
  MqttDatabase,
  parseDynamoAttrType,
  RdsDatabase,
  RedisDatabase,
  resolveLastOrderByColumn,
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
import { getIconPath } from "../../utilities/fsUtil";
import { log } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";

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

const DB_TYPE_DISPLAY_NAMES: Record<DBType, string> = {
  [DBType.MySQL]: "MySQL",
  [DBType.Postgres]: "PostgreSQL",
  [DBType.SQLServer]: "SQL Server",
  [DBType.SQLite]: "SQLite",
  [DBType.Oracle]: "Oracle",
  [DBType.Redis]: "Redis",
  [DBType.Memcache]: "Memcached",
  [DBType.Keycloak]: "Keycloak",
  [DBType.Auth0]: "Auth0",
  [DBType.Aws]: "AWS",
  [DBType.Mqtt]: "MQTT",
};

const toDbTypeDisplayName = (dbType: DBType): string => DB_TYPE_DISPLAY_NAMES[dbType] ?? dbType;

// Vendor logos for the DBTypes where a safely-licensed brand mark is available
// (see misc/resource-tree-icons-investigation-2026-08-02.md, Tier A). Oracle/SQL
// Server/AWS/Memcached deliberately stay on generic codicons for now.
const VENDOR_ICONS = {
  mysql: "db-vendor-mysql.svg",
  postgresql: "db-vendor-postgresql.svg",
  sqlite: "db-vendor-sqlite.svg",
  redis: "db-vendor-redis.svg",
  mqtt: "db-vendor-mqtt.svg",
  auth0: "db-vendor-auth0.svg",
} as const;

const toAwsServiceIconFileName = (serviceType: AwsServiceType): string => {
  switch (serviceType) {
    case AwsServiceType.S3:
      return "archive";
    case AwsServiceType.SQS:
      return "combine";
    case AwsServiceType.SES:
      return "mail";
    case AwsServiceType.Cloudwatch:
      return "pulse";
    case AwsServiceType.DynamoDB:
      return "table";
    default:
      return "database";
  }
};

let defaultConName = "";

export class ResourceTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.FileDecorationProvider
{
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> =
    new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> =
    this._onDidChangeTreeData.event;
  private _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  private conResList: DbConnection[] = [];
  private parentMap = new Map<string, DbResource | undefined>();

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
      this.parentMap.clear();
    }
    this.resetDefaultConnectionName();
    this._onDidChangeTreeData.fire();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  async resetDefaultConnectionName(): Promise<void> {
    defaultConName = this.stateStorage.getDefaultConnectionName();
  }

  changeConnectionTreeData(conRes: DbConnection): void {
    this.resetDefaultConnectionName();
    this._onDidChangeTreeData.fire(conRes);
    this._onDidChangeTreeData.fire();
    this._onDidChangeFileDecorations.fire(this.connectionUri(conRes));
  }

  private connectionUri(conRes: DbConnection): vscode.Uri {
    return vscode.Uri.from({ scheme: "db-notebook-connection", path: "/" + conRes.name });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== "db-notebook-connection") {
      return undefined;
    }
    const name = uri.path.replace(/^\//, "");
    const conRes = this.conResList.find((c) => c.name === name);
    if (!conRes?.environment) {
      return undefined;
    }
    const map: Record<ConnectionEnvironment, { badge: string; color?: string }> = {
      local: { badge: "L" },
      development: { badge: "D", color: "charts.blue" },
      test: { badge: "T", color: "charts.purple" },
      staging: { badge: "S", color: "charts.orange" },
      production: { badge: "P", color: "charts.red" },
    };
    const entry = map[conRes.environment];
    return {
      badge: entry.badge,
      color: entry.color ? new vscode.ThemeColor(entry.color) : undefined,
      tooltip: `Environment: ${conRes.environment[0].toUpperCase()}${conRes.environment.slice(1)}`,
    };
  }

  changeDbResourceTreeData(dbRes: DbResource): void {
    this._onDidChangeTreeData.fire(dbRes);
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
      let children: DbResource[];
      if (element) {
        if (element.resourceType === ResourceType.Connection) {
          children = this.stateStorage.getResourceByName(element.name) ?? [];
        } else {
          children = element.children;
        }
      } else {
        // connection resource
        children = this.conResList;
      }
      children.forEach((child) => this.parentMap.set(child.id, element));
      return Promise.resolve(children);
    } catch (e) {
      console.error(e);
      return Promise.resolve([]);
    }
  }

  getParent(element: DbResource): vscode.ProviderResult<DbResource> {
    return this.parentMap.get(element.id);
  }

  // Drop stale parent links for a subtree that's about to be replaced (e.g. on schema reload),
  // since DbResource ids are freshly generated per instance and would otherwise pin the old
  // objects in `parentMap` forever, preventing them from being garbage collected.
  forgetResourceTree(resources: DbResource[] | undefined): void {
    if (!resources) {
      return;
    }
    for (const res of resources) {
      this.parentMap.delete(res.id);
      this.forgetResourceTree(res.children);
    }
  }
}

export class ConnectionListItem extends vscode.TreeItem {
  constructor(public readonly conRes: DbConnection, state: vscode.TreeItemCollapsibleState) {
    super(conRes.name, state);

    this.resourceUri = vscode.Uri.from({
      scheme: "db-notebook-connection",
      path: "/" + conRes.name,
    });

    const isDefault = conRes.name === defaultConName;
    // Connection status (spinner/connected/disconnected) always reflects the real
    // state here -- "is the default connection" is surfaced separately below
    // (description + tooltip), so it no longer overrides/hides a live connection.
    if (conRes.isInProgress) {
      this.iconPath = new vscode.ThemeIcon("loading~spin");
    } else if (conRes.isConnected) {
      this.iconPath = new vscode.ThemeIcon("pass");
    } else {
      this.iconPath = new vscode.ThemeIcon("debug-disconnect");
    }
    const clearableDefault = isDefault;
    this.description = `(${toDbTypeDisplayName(conRes.dbType)})`;
    if (conRes.dbType === DBType.Mqtt) {
      this.description += ` (${conRes.isConnected ? "connected" : "disconnected"})`;
    }
    if (isDefault) {
      this.description += " (default)";
    }
    const support = DBType.Mqtt !== conRes.dbType;
    this.contextValue = `${conRes.resourceType},dbType:${conRes.dbType},CD:${clearableDefault},connected:${conRes.isConnected},support:${support},${conRes.isInProgress}`;
    this.contextValue += ",tag:dbResource";

    const tooltip = new vscode.MarkdownString(encodeHtmlWeak(conRes.name), true);
    tooltip.supportHtml = true;
    tooltip.isTrusted = true;
    tooltip.appendMarkdown(`\\\n${toDbTypeDisplayName(conRes.dbType)}`);
    if (conRes.host) {
      tooltip.appendMarkdown(
        `\\\n${encodeHtmlWeak(conRes.host)}${conRes.port ? `:${conRes.port}` : ""}`
      );
    }
    if (conRes.database) {
      tooltip.appendMarkdown(`\\\nDatabase: ${encodeHtmlWeak(conRes.database)}`);
    }
    if (conRes.environment) {
      tooltip.appendMarkdown(
        `\\\nEnvironment: ${conRes.environment[0].toUpperCase()}${conRes.environment.slice(1)}`
      );
    }
    if (conRes.comment) {
      tooltip.appendMarkdown(`\\\n${encodeHtmlWeak(conRes.comment)}`);
    }
    if (conRes.hasSshSetting()) {
      tooltip.appendMarkdown("\\\nSSH tunnel enabled");
    }
    if (conRes.ssl?.use) {
      tooltip.appendMarkdown("\\\nSSL enabled");
    }
    if (isDefault) {
      tooltip.appendMarkdown("\\\nDefault connection for new SQL cells");
    }
    this.tooltip = tooltip;
  }
}

export class DBDatabaseItem extends vscode.TreeItem {
  constructor(
    public readonly resource: DbResource,
    state: vscode.TreeItemCollapsibleState,
    private stateStorage: StateStorage
  ) {
    super(resource.name, state);

    let iconPath: vscode.TreeItem["iconPath"] = new vscode.ThemeIcon("database");
    let description = resource.comment || "";
    let scannable = false;
    let showSessions = false;
    let exportable = false;
    let canViewLastRows = false;
    let tooltip: string | vscode.MarkdownString | undefined;
    let dbType: DBType | undefined = undefined;
    if (resource.meta) {
      dbType = resource.meta.dbType;
    }

    switch (resource.resourceType) {
      case ResourceType.RdsDatabase:
        {
          const res = resource as RdsDatabase;
          switch (dbType) {
            case DBType.MySQL:
              iconPath = getIconPath(VENDOR_ICONS.mysql);
              break;
            case DBType.Postgres:
              iconPath = getIconPath(VENDOR_ICONS.postgresql);
              break;
            case DBType.SQLite:
              iconPath = getIconPath(VENDOR_ICONS.sqlite);
              break;
            case DBType.Oracle:
              iconPath = new vscode.ThemeIcon(
                "server-environment",
                new vscode.ThemeColor("charts.red")
              );
              break;
            case DBType.SQLServer:
              iconPath = new vscode.ThemeIcon(
                "server-environment",
                new vscode.ThemeColor("charts.blue")
              );
              break;
            default:
              iconPath = new vscode.ThemeIcon("database");
          }
          if (
            dbType === DBType.MySQL ||
            dbType === DBType.Postgres ||
            dbType === DBType.SQLServer ||
            dbType === DBType.Oracle
          ) {
            showSessions = true;
          }
          exportable =
            dbType === DBType.MySQL ||
            dbType === DBType.Postgres ||
            dbType === DBType.SQLite ||
            dbType === DBType.Oracle;
        }
        break;
      case ResourceType.AwsDatabase:
        {
          const res = resource as AwsDatabase;
          iconPath = new vscode.ThemeIcon(toAwsServiceIconFileName(res.serviceType));
        }
        break;
      case ResourceType.KeycloakDatabase:
        iconPath = new vscode.ThemeIcon("database");
        break;
      case ResourceType.Auth0Database:
        iconPath = getIconPath(VENDOR_ICONS.auth0);
        scannable = true;
        break;
      case ResourceType.RedisDatabase:
        {
          const res = resource as RedisDatabase;
          iconPath = getIconPath(VENDOR_ICONS.redis);
          description = `${res.numOfKeys} keys`;
          scannable = true;
        }
        break;
      case ResourceType.MemcacheDatabase:
        {
          const res = resource as MemcacheDatabase;
          iconPath = new vscode.ThemeIcon("server");
          scannable = true;
        }
        break;
      case ResourceType.MqttDatabase:
        {
          const res = resource as MqttDatabase;
          iconPath = getIconPath(VENDOR_ICONS.mqtt);
          scannable = false;
        }
        break;
      case ResourceType.Key:
        iconPath = new vscode.ThemeIcon("key");
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
        iconPath = new vscode.ThemeIcon("list-selection");
        scannable = true;
        break;
      case ResourceType.Table:
        {
          iconPath = new vscode.ThemeIcon("table");
          if (dbType && isRDSType(dbType)) {
            if (resource instanceof DbTable) {
              const res = resource as DbTable;
              const lastColumn = resolveLastOrderByColumn(res);
              canViewLastRows = lastColumn !== undefined;
            }
          }
        }
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
          iconPath = new vscode.ThemeIcon("symbol-class");
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
        iconPath = new vscode.ThemeIcon("shield");
        scannable = true;
        break;
      case ResourceType.IamGroup:
        iconPath = new vscode.ThemeIcon("organization");
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
          // icon color by column attribute
          let color: vscode.ThemeColor | undefined = undefined;
          if (c.pk) {
            color = new vscode.ThemeColor("charts.blue");
          } else if (c.sk) {
            // NOT NULL
            color = new vscode.ThemeColor("charts.orange");
          }
          iconPath = new vscode.ThemeIcon(toIconFileName(parseDynamoAttrType(c.attrType)), color);
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
          // icon color by column attribute
          let color: vscode.ThemeColor | undefined = undefined;
          if (c.primaryKey) {
            color = new vscode.ThemeColor("charts.blue");
          } else if (!c.nullable) {
            // NOT NULL
            color = new vscode.ThemeColor("charts.orange");
          }
          iconPath = new vscode.ThemeIcon(toIconFileName(c.colType), color);
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
    if (exportable) {
      contextValue += ",exportable";
    }
    if (scannable) {
      contextValue += ",scannable";
    }
    if (canViewLastRows) {
      contextValue += ",canViewLastRows";
    }
    contextValue += ",tag:dbResource";

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
