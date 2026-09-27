import {
  AwsDatabase,
  AwsServiceType,
  DbCfnStack,
  DbColumn,
  DbConnection,
  DbDynamoTable,
  DbDynamoTableColumn,
  DbResource,
  DbSecretsManagerSecret,
  DbSESIdentity,
  DbSQSQueue,
  DbSsmParameter,
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
import {
  CONNECTION_ENVIRONMENT_BADGE,
  formatConnectionEnvironmentCapitalized,
} from "../../utilities/connectionEnvironmentDisplay";
import { getIconPath } from "../../utilities/fsUtil";
import { log } from "../../utilities/logger";
import { ResourceFavorite, StateStorage } from "../../utilities/StateStorage";
import { appendDashboardContextValues } from "../../observability/dashboardLaunch";
import { getDynamoDbIndexKeyRoles } from "./dynamoDbKeyRoles";

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

const SEARCHABLE_RESOURCE_TYPES = new Set<ResourceType>([
  ResourceType.Table,
  ResourceType.DynamoTable,
  ResourceType.LogGroup,
  ResourceType.Bucket,
  ResourceType.Queue,
  ResourceType.Identity,
  ResourceType.SsmParameter,
  ResourceType.SecretsManagerSecret,
  ResourceType.CfnStack,
]);

export type LoadedResourceMatch = {
  resource: DbResource;
  connection: DbConnection;
  path: string[];
  resourcePath: ResourceFavorite["path"];
};

const activeResourceFilters = (conRes: DbConnection) =>
  ([
    ["Resource name", conRes.resourceFilter?.resourceName],
    ["Schema", conRes.resourceFilter?.schema],
    ["Table", conRes.resourceFilter?.table],
  ] as const).filter(([, detail]) => detail?.value?.trim());

// Vendor logos for the DBTypes where a safely-licensed brand mark is available.
// Oracle/SQL Server/AWS/Memcached deliberately stay on generic codicons for now.
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
    case AwsServiceType.SSM:
      return "symbol-variable";
    case AwsServiceType.SecretsManager:
      return "key";
    case AwsServiceType.CloudFormation:
      return "layers";
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
    const entry = CONNECTION_ENVIRONMENT_BADGE[conRes.environment];
    return {
      badge: entry.badge,
      color: entry.color ? new vscode.ThemeColor(entry.color) : undefined,
      tooltip: `Environment: ${formatConnectionEnvironmentCapitalized(conRes.environment)}`,
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
    const favorite = this.getFavoriteForResource(element);
    return new DBDatabaseItem(
      element,
      state,
      this.stateStorage,
      this.parentMap.get(element.id),
      favorite ? this.stateStorage.isResourceFavorite(favorite) : false
    );
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

  getLoadedResourceMatches(connection?: DbConnection): LoadedResourceMatch[] {
    const matches: LoadedResourceMatch[] = [];
    const connections = connection ? this.conResList.filter((it) => it === connection) : this.conResList;
    for (const conRes of connections) {
      const visit = (
        resource: DbResource,
        parent: DbResource,
        path: string[],
        resourcePath: ResourceFavorite["path"]
      ) => {
        this.parentMap.set(resource.id, parent);
        const currentPath = [...path, resource.name];
        const currentResourcePath = resource.resourceType === ResourceType.Group
          ? resourcePath
          : [...resourcePath, { type: resource.resourceType, name: resource.name }];
        if (SEARCHABLE_RESOURCE_TYPES.has(resource.resourceType)) {
          matches.push({ resource, connection: conRes, path: currentPath, resourcePath: currentResourcePath });
        }
        // Columns are not Quick Open targets; avoid walking large column lists.
        if (resource.resourceType !== ResourceType.Table && resource.resourceType !== ResourceType.DynamoTable) {
          resource.children.forEach((child) => visit(child, resource, currentPath, currentResourcePath));
        }
      };
      (this.stateStorage.getResourceByName(conRes.name) ?? []).forEach((db) =>
        visit(db, conRes, [conRes.name], [])
      );
    }
    return matches;
  }

  getFavoriteForResource(resource: DbResource): ResourceFavorite | undefined {
    if (!SEARCHABLE_RESOURCE_TYPES.has(resource.resourceType)) {
      return undefined;
    }
    const path: ResourceFavorite["path"] = [];
    let current: DbResource | undefined = resource;
    while (current && !(current instanceof DbConnection)) {
      if (current.resourceType !== ResourceType.Group) {
        path.unshift({ type: current.resourceType, name: current.name });
      }
      current = this.parentMap.get(current.id);
    }
    if (!(current instanceof DbConnection)) {
      return undefined;
    }
    const setting = this.stateStorage.getPasswordlessConnectionSettingByName(current.name);
    return setting?.id ? { connectionId: setting.id, connectionName: current.name, path } : undefined;
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
    const filters = activeResourceFilters(conRes);
    if (filters.length) {
      this.description += " · filtered";
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
      tooltip.appendMarkdown(`\\\nEnvironment: ${formatConnectionEnvironmentCapitalized(conRes.environment)}`);
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
    const filterTypes = { prefix: "starts with", suffix: "ends with", include: "contains", regex: "regex" };
    for (const [label, detail] of filters) {
      if (detail) {
        tooltip.appendMarkdown(`\\\n${label} filter (${filterTypes[detail.type]}): `);
        tooltip.appendText(detail.value);
      }
    }
    if (conRes.readOnly === true) {
      tooltip.appendMarkdown("\\\nRead-only setting: enabled (behavior depends on the database)");
    }
    this.tooltip = tooltip;
  }
}

export class DBDatabaseItem extends vscode.TreeItem {
  constructor(
    public readonly resource: DbResource,
    state: vscode.TreeItemCollapsibleState,
    private stateStorage: StateStorage,
    private readonly parentResource?: DbResource,
    private readonly isFavorite = false
  ) {
    super(resource.name, state);

    let iconPath: vscode.TreeItem["iconPath"] = new vscode.ThemeIcon("database");
    let description = resource.comment || "";
    let scannable = false;
    let showSessions = false;
    let showQueryStatistics = false;
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
            // Query Statistics still performs a runtime capability check when
            // the view opens; it is independent from session support.
            showQueryStatistics = true;
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
          // Unlike S3/SQS/CloudWatch (where a child resource, e.g. a bucket or
          // queue, is the scan target), SSM parameters/Secrets Manager secrets
          // have no further sub-resource to drill into - the service node
          // itself is the scan target, listing all parameters/secrets at once.
          if (
            res.serviceType === AwsServiceType.SSM ||
            res.serviceType === AwsServiceType.SecretsManager
          ) {
            scannable = true;
          }
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
        {
          // Same base shape as an ordinary queue, but a queue that is
          // itself the DLQ target of a sibling queue's RedrivePolicy gets
          // an orange color + explicit "(DLQ)" label, so it's not only
          // distinguishable by color. attr.isDlq is computed by
          // AwsSQSServiceClient#getInfomationSchemas() in db-drivers.
          const queue = resource as DbSQSQueue;
          const isDlq = queue.attr?.isDlq === true;
          const color = isDlq ? new vscode.ThemeColor("charts.orange") : undefined;
          iconPath = new vscode.ThemeIcon("list-selection", color);
          if (isDlq) {
            description = "(DLQ)";
          }
        }
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
      case ResourceType.Identity:
        {
          const identity = resource as DbSESIdentity;
          // icon shape by identity type, color by verification status
          const iconFile = identity.attr.identityType === "Domain" ? "globe" : "mail";
          let color: vscode.ThemeColor | undefined = undefined;
          switch (identity.attr.verificationStatus) {
            case "Success":
              color = new vscode.ThemeColor("charts.green");
              break;
            case "Failed":
            case "TemporaryFailure":
              color = new vscode.ThemeColor("charts.red");
              break;
            case "Pending":
              color = new vscode.ThemeColor("charts.yellow");
              break;
          }
          iconPath = new vscode.ThemeIcon(iconFile, color);
          description = `(${identity.attr.verificationStatus ?? "NotStarted"})`;
        }
        break;
      case ResourceType.SsmParameter:
        {
          const param = resource as DbSsmParameter;
          // icon shape by parameter type, color flags SecureString as sensitive
          let iconFile = "symbol-variable";
          let color: vscode.ThemeColor | undefined = undefined;
          if (param.attr.type === "StringList") {
            iconFile = "list-unordered";
          } else if (param.attr.type === "SecureString") {
            iconFile = "lock";
            color = new vscode.ThemeColor("charts.orange");
          }
          iconPath = new vscode.ThemeIcon(iconFile, color);
          description = `(${param.attr.type})`;
        }
        break;
      case ResourceType.SecretsManagerSecret:
        {
          const secret = resource as DbSecretsManagerSecret;
          // color flags secrets with rotation enabled
          const color = secret.attr.rotationEnabled
            ? new vscode.ThemeColor("charts.green")
            : undefined;
          iconPath = new vscode.ThemeIcon("key", color);
          if (secret.attr.rotationEnabled) {
            description = "(rotation enabled)";
          }
        }
        break;
      case ResourceType.CfnStack:
        {
          // Not scannable: a stack's resources are DescribeStackResources
          // data on attr.resources, not individually-scannable child nodes
          // (see AwsCfnStackAttributes.ts). Color flags a non-*_COMPLETE
          // status (failed/rollback/in-progress) as noteworthy.
          const stack = resource as DbCfnStack;
          const status = stack.attr.stackStatus;
          const isHealthy = status?.endsWith("_COMPLETE") && !status.includes("ROLLBACK");
          const color = isHealthy ? undefined : new vscode.ThemeColor("charts.orange");
          iconPath = new vscode.ThemeIcon("layers", color);
          description = `(${status})`;
        }
        break;
      case ResourceType.Group:
        // Generic display-only container (e.g. SSM parameters grouped by
        // type, Secrets Manager secrets grouped by rotation status) - never
        // scannable. Count shown as a description, same convention as
        // DynamoTable's item count above.
        iconPath = new vscode.ThemeIcon("folder");
        {
          const count = resource.children.length;
          if (count === 1) {
            description += ` 1 item`;
          } else if (count === 0) {
            description += ` No items`;
          } else {
            description += ` ${count} items`;
          }
        }
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
            tooltip.appendMarkdown(`\\\nPARTITION KEY`);
          }
          if (c.sk) {
            description = "(sk)";
            tooltip.appendMarkdown(`\\\nSORT KEY`);
          }
          if (this.parentResource instanceof DbDynamoTable) {
            for (const role of getDynamoDbIndexKeyRoles(this.parentResource, c.name)) {
              tooltip.appendMarkdown(
                `\\\n${role.indexType} "${encodeHtmlWeak(role.indexName)}": ${role.keyType}`
              );
            }
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
    let contextValue: string = resource.resourceType;

    if (resource.resourceType === ResourceType.Subscription) {
      const subscription = resource as DbSubscription;
      contextValue += `,isSubscribed=${subscription.isSubscribed}`;
    }
    if (resource.resourceType === ResourceType.AwsDatabase) {
      // Distinguishes which AWS service this node represents (S3/SQS/.../
      // CloudFormation all share resourceType AwsDatabase) so a menu entry
      // can target just one, e.g. the CloudFormation node's "diagram every
      // stack" command.
      const awsDb = resource as AwsDatabase;
      contextValue += `,service:${awsDb.serviceType}`;
    }
    contextValue += ",properties";
    if (showSessions) {
      contextValue += ",showSessions";
    }
    if (showQueryStatistics) {
      contextValue += ",showQueryStatistics";
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
    contextValue = appendDashboardContextValues(contextValue, resource);
    if (SEARCHABLE_RESOURCE_TYPES.has(resource.resourceType)) {
      contextValue += `,favorite:${this.isFavorite}`;
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
