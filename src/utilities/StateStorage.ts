import {
  Auth0Database,
  AwsDatabase,
  AwsServiceType,
  ConnectionEnvironment,
  ConnectionSetting,
  DBType,
  DbCfnStack,
  DbDatabase,
  DbDynamoTable,
  DbLogGroup,
  DbResourceGroup,
  DbS3Bucket,
  DbSecretsManagerSecret,
  DbSQSQueue,
  DbSchema,
  DbSsmParameter,
  DbSubscription,
  GeneralResult,
  IamClient,
  IamGroup,
  IamOrganization,
  IamRealm,
  RdsDatabase,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { sleep } from "@l-v-yonsama/rdh";
import ShortUniqueId from "short-unique-id";
import { ExtensionContext, SecretStorage } from "vscode";
import { EXTENSION_NAME } from "../constant";
import { showStatusMessage } from "../statusBar";
import { QueryHistory } from "../types/QueryHistory";
import { workflow } from "./driverResolver";
import {
  createInitialQueryHistoryPerformance,
  isQueryHistoryTarget,
  mergeQueryHistoryPerformance,
  migrateStoredQueryHistory,
  resetQueryHistoryPerformance,
  StoredQueryHistory,
} from "./queryHistoryUtil";
import { log } from "./logger";

const uid = new ShortUniqueId();

const PREFIX = "[StateStorage]";

export const DEFAULT_CON_NAME_KEY = `${EXTENSION_NAME}-DEFAULT-CON-NAME`;
export const STORAGE_KEY = `${EXTENSION_NAME}-settings`;
// The stored value keeps its original `-sql-history` suffix even though the
// view is now called Query History: renaming the globalState key itself would
// orphan every existing user's saved history for no functional gain.
export const QUERY_HISTORY_STORAGE_KEY = `${EXTENSION_NAME}-sql-history`;
export const PREV_SAVE_FOLDER = `${EXTENSION_NAME}-previous-save-folder`;
export const MCP_ENABLED_CONNECTIONS_KEY = `${EXTENSION_NAME}-mcp-enabled-connections`;

type DbResInfo = {
  isInProgress: boolean;
  res?: DbDatabase[];
};

type SecretParamName = "password" | "clientSecret" | "sessionToken";

export class StateStorage {
  private resMap = new Map<string, DbResInfo>();

  getResourceByName(connectionName: string): DbDatabase[] | undefined {
    // log(`${PREFIX} getResourceByName(${connectionName})`);

    if (this.resMap.has(connectionName)) {
      return this.resMap.get(connectionName)?.res;
    }
    return undefined;
  }

  getCloudwatchDatabase(connectionName: string): AwsDatabase | undefined {
    const dbs = this.getResourceByName(connectionName) as AwsDatabase[];
    if (dbs === undefined) {
      return;
    }
    return dbs.find((it) => it.name === "Cloudwatch");
  }

  getCloudFormationDatabase(connectionName: string): AwsDatabase | undefined {
    const dbs = this.getResourceByName(connectionName) as AwsDatabase[];
    if (dbs === undefined) {
      return;
    }
    return dbs.find((it) => it.name === "CloudFormation");
  }

  getFirstRdsDatabaseByName(connectionName: string): RdsDatabase | undefined {
    const dbs = this.getResourceByName(connectionName);
    return dbs?.find((it) => it instanceof RdsDatabase) as RdsDatabase;
  }

  async loadResource(
    connectionName: string,
    reload: boolean,
    wait = false
  ): Promise<GeneralResult<{ db: DbDatabase[]; dbType: DBType; }>> {
    // log(`${PREFIX} loadResource(${connectionName}, reload:${reload}, wait:${wait})`);
    const ret: GeneralResult<{ db: DbDatabase[]; dbType: DBType; }> = {
      ok: false,
      message: "",
    };
    const conRes = await this.getConnectionSettingByName(connectionName);
    if (!conRes) {
      ret.message = `Missing connection setting ${connectionName}`;
      return ret;
    }
    const { dbType } = conRes;
    let resInfo = this.resMap.get(connectionName);
    if (resInfo?.res && !reload) {
      // Hit cache
      ret.ok = true;
      ret.result = { db: resInfo.res, dbType };
      return ret;
    }
    if (resInfo?.isInProgress) {
      if (!wait) {
        ret.message = "skipped.";
        return ret;
      }
      for (let i = 0; i < 6 && resInfo?.isInProgress; i++) {
        await sleep(500);
        resInfo = this.resMap.get(connectionName);
      }
      // log(`${PREFIX} loadResource return res`);
      if (resInfo?.res) {
        ret.ok = true;
        ret.result = { db: resInfo.res, dbType };
      } else {
        ret.message = "skipped.";
      }
      return ret;
    }
    if (!resInfo) {
      resInfo = {
        isInProgress: true,
      };
      this.resMap.set(connectionName, resInfo);
    }

    const { ok, message, result } = await workflow(
      conRes,
      async (driver) => await driver.getInfomationSchemas(),
      reload
    );

    if (ok && result) {
      for (const dbRes of result) {
        dbRes.meta = {
          conName: conRes.name,
          dbType: conRes.dbType,
        };
        // for rds
        dbRes.findChildren<DbSchema>({ resourceType: ResourceType.Schema }).forEach((schemaRes) => {
          schemaRes.meta = {
            conName: conRes.name,
          };
          schemaRes.children.forEach((tableRes) => {
            tableRes.meta = {
              conName: conRes.name,
              schemaName: schemaRes.name,
              dbType: conRes.dbType,
            };
          });
        });
        // for aws resource ---------
        // for s3
        dbRes.findChildren<DbS3Bucket>({ resourceType: ResourceType.Bucket }).forEach((bucket) => {
          bucket.meta = {
            conName: conRes.name,
          };
        });
        // for sqs
        dbRes.findChildren<DbSQSQueue>({ resourceType: ResourceType.Queue }).forEach((queueRes) => {
          queueRes.meta = {
            conName: conRes.name,
          };
        });
        // for cloudwatch
        dbRes
          .findChildren<DbLogGroup>({ resourceType: ResourceType.LogGroup })
          .forEach((logGroupRes) => {
            logGroupRes.meta = {
              conName: conRes.name,
            };
          });
        // for dynamoDB
        dbRes
          .findChildren<DbDynamoTable>({ resourceType: ResourceType.DynamoTable })
          .forEach((tableRes) => {
            tableRes.meta = {
              conName: conRes.name,
            };
          });
        // for cloudformation - not scannable (see the CfnStack case in
        // ResourceTreeProvider), but still needs conName stamped so the
        // "Create CloudFormation diagram" command can resolve a connection
        // setting from the tree item alone.
        dbRes.findChildren<DbCfnStack>({ resourceType: ResourceType.CfnStack }).forEach((stackRes) => {
          stackRes.meta = {
            conName: conRes.name,
          };
        });
        // for ssm
        {
          const params = dbRes.findChildren<DbSsmParameter>({
            resourceType: ResourceType.SsmParameter,
          });
          params.forEach((paramRes) => {
            paramRes.meta = {
              conName: conRes.name,
            };
          });
          // Tree-display-only grouping by parameter type. Never affects
          // getInfomationSchemas()'s own return value (params were already
          // direct children when the block above stamped them) or the AI
          // tools' schema output, which calls the driver directly and never
          // goes through this cached, UI-facing tree.
          if (
            dbRes instanceof AwsDatabase &&
            dbRes.serviceType === AwsServiceType.SSM &&
            params.length > 0
          ) {
            const byType = new Map<string, DbSsmParameter[]>();
            params.forEach((p) => {
              const list = byType.get(p.attr.type) ?? [];
              list.push(p);
              byType.set(p.attr.type, list);
            });
            const groups: DbResourceGroup[] = [];
            (["String", "StringList", "SecureString"] as const).forEach((type) => {
              const list = byType.get(type);
              if (list && list.length > 0) {
                const group = new DbResourceGroup(`${type} params`);
                list.forEach((p) => group.addChild(p));
                groups.push(group);
              }
            });
            dbRes.children.splice(0, dbRes.children.length, ...groups);
          }
        }
        // for secrets manager
        {
          const secrets = dbRes.findChildren<DbSecretsManagerSecret>({
            resourceType: ResourceType.SecretsManagerSecret,
          });
          secrets.forEach((secretRes) => {
            secretRes.meta = {
              conName: conRes.name,
            };
          });
          // Tree-display-only grouping by rotation status. See the note on
          // the SSM grouping above -- same rationale applies here.
          if (
            dbRes instanceof AwsDatabase &&
            dbRes.serviceType === AwsServiceType.SecretsManager &&
            secrets.length > 0
          ) {
            const enabled = secrets.filter((s) => s.attr.rotationEnabled);
            const disabled = secrets.filter((s) => !s.attr.rotationEnabled);
            const groups: DbResourceGroup[] = [];
            if (enabled.length > 0) {
              const group = new DbResourceGroup(`Rotation enabled`);
              enabled.forEach((s) => group.addChild(s));
              groups.push(group);
            }
            if (disabled.length > 0) {
              const group = new DbResourceGroup(`Rotation disabled`);
              disabled.forEach((s) => group.addChild(s));
              groups.push(group);
            }
            dbRes.children.splice(0, dbRes.children.length, ...groups);
          }
        }
        // for Keycloak resource ---------
        dbRes.findChildren<IamRealm>({ resourceType: ResourceType.IamRealm }).forEach((realm) => {
          realm.meta = {
            conName: conRes.name,
          };
          realm
            .findChildren<IamClient>({ resourceType: ResourceType.IamClient, recursively: true })
            .forEach((it) => {
              it.meta = {
                conName: conRes.name,
                realmName: realm.name,
                scannable: true,
              };
            });
          realm
            .findChildren<IamGroup>({ resourceType: ResourceType.IamGroup, recursively: true })
            .forEach((it) => {
              it.meta = {
                conName: conRes.name,
                groupId: dbRes.id,
                realmName: realm.name,
              };
            });
        });
        // for auth0 resource ---------
        if (dbRes instanceof Auth0Database) {
          dbRes.meta = {
            conName: conRes.name,
          };
          dbRes
            .findChildren<IamOrganization>({
              resourceType: ResourceType.IamOrganization,
              recursively: true,
            })
            .forEach((it) => {
              it.meta = {
                conName: conRes.name,
                organizationId: dbRes.id,
              };
            });
        }
        // for mqtt resource ---------
        dbRes
          .findChildren<DbSubscription>({ resourceType: ResourceType.Subscription })
          .forEach((client) => {
            client.meta = {
              conName: conRes.name,
            };
          });
      }
      this.resMap.set(connectionName, { isInProgress: false, res: result });
      ret.result = { db: result, dbType };
      ret.ok = true;
    } else {
      log(`${PREFIX} loadResource Error:${message}`);
      this.resMap.set(connectionName, { isInProgress: false, res: undefined });
      ret.message = message;
      showStatusMessage(message, 'warning');
    }
    return ret;
  }

  resetResource(connectionName: string, databases: DbDatabase[]) {
    this.resMap.set(connectionName, { isInProgress: false, res: databases });
  }

  constructor(private context: ExtensionContext, private secretStorage: SecretStorage) {}

  getDefaultConnectionName(): string {
    return this.context.globalState.get<string>(DEFAULT_CON_NAME_KEY, "");
  }
  setDefaultConnectionName(name: string): void {
    this.context.globalState.update(DEFAULT_CON_NAME_KEY, name);
  }

  async getPreviousSaveFolder(): Promise<string> {
    return this.context.globalState.get<string>(PREV_SAVE_FOLDER, "");
  }

  async setPreviousSaveFolder(folderPath: string): Promise<void> {
    this.context.globalState.update(PREV_SAVE_FOLDER, folderPath);
  }

  async getQueryHistoryList(): Promise<QueryHistory[]> {
    const storedList = this.context.globalState.get<StoredQueryHistory[]>(
      QUERY_HISTORY_STORAGE_KEY,
      []
    );
    const list = storedList.flatMap((stored) => {
      const migrated = migrateStoredQueryHistory(stored);
      return migrated ? [migrated] : [];
    });

    // 読み込み時に旧sqlModeを除去し、performanceを補完する。Explain系の
    // 旧エントリもここで除外するため、再実行を待たず一度だけ移行できる。
    if (JSON.stringify(storedList) !== JSON.stringify(list)) {
      await this.context.globalState.update(QUERY_HISTORY_STORAGE_KEY, list);
    }
    return list;
  }

  async addQueryHistory(
    history: Omit<QueryHistory, "id" | "performance" | "lastErrorMessage" | "lastErrorAt">
  ): Promise<boolean> {
    // 呼び出し元の実行モードだけに依存せず、保存境界でもraw EXPLAINを拒否する。
    if (!isQueryHistoryTarget(history)) {
      return false;
    }
    const list = await this.getQueryHistoryList();

    // Identity: a native Query history entry is identified by its
    // structural key (design doc §4.2), never by sqlDoc - sqlDoc is only a
    // value-free description text for this kind, and a real native Query
    // request has no equivalent of "trimmed SQL text" to compare. Every
    // other kind (including entries with no `request` at all, which predate
    // this field) keeps the existing sqlDoc+connectionName identity
    // unchanged.
    const dynamoRequest = history.request?.kind === "dynamodbQuery" ? history.request : undefined;
    const sameHistoryIndex = dynamoRequest
      ? list.findIndex(
          (it) =>
            it.request?.kind === "dynamodbQuery" &&
            it.request.structuralKey === dynamoRequest.structuralKey &&
            it.connectionName === history.connectionName
        )
      : (() => {
          const newTrimedSql = history.sqlDoc.trim();
          return list.findIndex(
            (it) =>
              it.request?.kind !== "dynamodbQuery" &&
              it.sqlDoc.trim() === newTrimedSql &&
              it.connectionName === history.connectionName
          );
        })();

    // Re-running the same SQL+connection moves it to the front (LRU), so a
    // frequently re-measured query survives the cap below instead of being
    // evicted by unrelated one-off queries while sitting at its old position.
    const isNew = sameHistoryIndex < 0;
    // DynamoDB API telemetry is namespaced under summary.dynamoDb and that
    // object is its sole source of truth. Do not silently fall back to the
    // generic display-oriented capacityUnits when a DynamoDB summary exists;
    // a disagreement would otherwise corrupt the history aggregate. The
    // generic field remains available for non-DynamoDB producers.
    const capacityUnits = history.summary?.dynamoDb
      ? history.summary.dynamoDb.consumedCapacity?.totalCapacityUnits
      : history.summary?.capacityUnits;
    const performance = isNew
      ? createInitialQueryHistoryPerformance(
          history.summary?.elapsedTimeMilli,
          capacityUnits,
          history.summary?.dynamoDb
        )
      : mergeQueryHistoryPerformance(
          list[sameHistoryIndex],
          history.summary?.elapsedTimeMilli,
          capacityUnits,
          history.summary?.dynamoDb
        );
    const previous = isNew ? undefined : list[sameHistoryIndex];
    if (previous) {
      list.splice(sameHistoryIndex, 1);
    }

    if (history.status === "error" && previous?.status === "success") {
      // 失敗した再実行は、直前の成功結果・bind・集計を壊さない。
      // 失敗情報だけを別フィールドに残し、次の再試行も可能にする。
      list.unshift({
        ...previous,
        id: uid.randomUUID(8),
        lastErrorMessage: history.errorMessage || "Unknown error",
        lastErrorAt: history.executedAt ?? Date.now(),
        performance,
      });
    } else {
      list.unshift({ ...history, id: uid.randomUUID(8), performance });
    }

    const maxHistory = 50;
    // 5: 5, 5-5=0
    // 6:, 5, 6-5=1
    if (list.length > maxHistory) {
      list.splice(maxHistory, list.length - maxHistory);
    }
    await this.context.globalState.update(QUERY_HISTORY_STORAGE_KEY, list);
    return isNew;
  }

  async deleteQueryHistoryByID(id: string): Promise<boolean> {
    const list = await this.getQueryHistoryList();
    const idx = list.findIndex((it) => it.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      await this.context.globalState.update(QUERY_HISTORY_STORAGE_KEY, list);
      return true;
    }
    return false;
  }

  async resetQueryHistoryPerformanceByID(id: string, resetAt = Date.now()): Promise<boolean> {
    const list = await this.getQueryHistoryList();
    const idx = list.findIndex((it) => it.id === id);
    if (idx < 0) {
      return false;
    }
    const history = list[idx];
    const includeDynamoDbAggregate =
      history.performance?.dynamoDb !== undefined || history.summary?.dynamoDb !== undefined;
    list[idx] = {
      ...history,
      performance: resetQueryHistoryPerformance(resetAt, includeDynamoDbAggregate),
    };
    await this.context.globalState.update(QUERY_HISTORY_STORAGE_KEY, list);
    return true;
  }

  async deleteAllQueryHistories(): Promise<boolean> {
    await this.context.globalState.update(QUERY_HISTORY_STORAGE_KEY, []);
    return true;
  }

  async getConnectionSettingList(): Promise<ConnectionSetting[]> {
    // log(`${PREFIX} getConnectionSettingList`);
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    for (const it of list) {
      if (it.id) {
        it.password = await this.getSecret(it.id, "password");
        if (it.dbType === "Auth0" && it.iamSolution) {
          it.iamSolution.clientSecret = await this.getSecret(it.id, "clientSecret");
        }
        if (it.dbType === "Aws" && it.awsSetting) {
          it.awsSetting.sessionToken = await this.getSecret(it.id, "sessionToken");
        }
      }
    }
    return list;
  }

  getPasswordlessConnectionSettingList(): ConnectionSetting[] {
    return this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
  }

  getPasswordlessConnectionSettingByName(name: string): ConnectionSetting | undefined {
    return this.getPasswordlessConnectionSettingList().find((it) => it.name === name);
  }

  async getConnectionSettingByName(name: string): Promise<ConnectionSetting | undefined> {
    // log(`${PREFIX} getConnectionSettingByName(${name})`);
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    const setting = list.find((it) => it.name === name);
    if (setting) {
      if (setting.id) {
        setting.password = await this.getSecret(setting.id, "password");
        if (setting.dbType === "Auth0" && setting.iamSolution) {
          setting.iamSolution.clientSecret = await this.getSecret(setting.id, "clientSecret");
        }
        if (setting.dbType === "Aws" && setting.awsSetting) {
          setting.awsSetting.sessionToken = await this.getSecret(setting.id, "sessionToken");
        }
      }
      return setting;
    }
    return undefined;
  }

  getConnectionSettingNames(): string[] {
    const list = this.getPasswordlessConnectionSettingList();
    return list.map((it) => it.name);
  }

  hasConnectionSettingByName(name: string): boolean {
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    return list.some((it) => it.name === name);
  }

  isMcpEnabledForConnection(name: string): boolean {
    const list = this.context.globalState.get<string[]>(MCP_ENABLED_CONNECTIONS_KEY, []);
    return list.includes(name);
  }

  async setMcpEnabledForConnection(name: string, enabled: boolean): Promise<void> {
    const list = this.context.globalState.get<string[]>(MCP_ENABLED_CONNECTIONS_KEY, []);
    const idx = list.indexOf(name);
    if (enabled && idx < 0) {
      list.push(name);
    } else if (!enabled && idx >= 0) {
      list.splice(idx, 1);
    } else {
      return;
    }
    await this.context.globalState.update(MCP_ENABLED_CONNECTIONS_KEY, list);
  }

  getDBTypeByConnectionName(name: string): DBType | undefined {
    return this.getPasswordlessConnectionSettingByName(name)?.dbType;
  }

  getEnvironmentByConnectionName(name: string): ConnectionEnvironment | undefined {
    return this.getPasswordlessConnectionSettingByName(name)?.environment;
  }

  getDBProductByConnectionName(name: string): string | undefined {
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    const setting = list.find((it) => it.name === name);
    const dbType = setting?.dbType;
    if (dbType) {
      if (dbType === "Aws") {
        return "DynamoDB";
      }
      return dbType || "";
    }
    return undefined;
  }

  async addConnectionSetting(setting: ConnectionSetting): Promise<boolean> {
    const list = await this.getConnectionSettingList();
    if (list.some((it) => it.name === setting.name)) {
      return false;
    }
    if (setting.id === undefined || setting.id === null || setting.id === "") {
      setting.id = uid.randomUUID(8);
    }
    await this.removePasswordAndStoreOnSecret(setting);
    await this.removeClientSecretAndStoreOnSecret(setting);
    await this.removeAwsSessionTokenAndStoreOnSecret(setting);
    list.push(setting);
    await this.context.globalState.update(STORAGE_KEY, list);
    return true;
  }

  async editConnectionSetting(setting: ConnectionSetting): Promise<boolean> {
    const list = await this.getConnectionSettingList();
    const idx = list.findIndex((it) => it.name === setting.name);
    if (idx < 0) {
      return false;
    }
    if (setting.id === undefined || setting.id === null || setting.id === "") {
      setting.id = uid.randomUUID(8);
    }
    await this.removePasswordAndStoreOnSecret(setting);
    await this.removeClientSecretAndStoreOnSecret(setting);
    await this.removeAwsSessionTokenAndStoreOnSecret(setting);

    list.splice(idx, 1, setting);
    await this.context.globalState.update(STORAGE_KEY, list);

    return true;
  }

  async deleteConnectionSetting(name: string): Promise<boolean> {
    // log(`${PREFIX} deleteConnectionSetting name:[${name}]`);
    const list = await this.getConnectionSettingList();
    const idx = list.findIndex((it) => it.name === name);
    if (idx < 0) {
      return false;
    }
    const removed = list.splice(idx, 1);
    if (removed && removed[0].id) {
      await this.deleteSecret(removed[0].id, "password");
      if (removed[0].dbType === "Auth0" && removed[0].iamSolution) {
        await this.deleteSecret(removed[0].id, "clientSecret");
      }
      if (removed[0].dbType === "Aws" && removed[0].awsSetting) {
        await this.deleteSecret(removed[0].id, "sessionToken");
      }
    }
    await this.context.globalState.update(STORAGE_KEY, list);
    this.resMap.delete(name);
    await this.setMcpEnabledForConnection(name, false);
    return true;
  }

  private async removePasswordAndStoreOnSecret(setting: ConnectionSetting): Promise<void> {
    if (setting.id) {
      if (setting.password) {
        await this.storeSecret(setting.id, "password", setting.password);
      }
      setting.password = undefined;
    }
  }

  private async removeClientSecretAndStoreOnSecret(setting: ConnectionSetting): Promise<void> {
    if (setting.id) {
      if (setting.dbType === "Auth0" && setting.iamSolution && setting.iamSolution.clientSecret) {
        await this.storeSecret(setting.id, "clientSecret", setting.iamSolution.clientSecret);
        setting.iamSolution.clientSecret = undefined;
      }
    }
  }

  private async removeAwsSessionTokenAndStoreOnSecret(setting: ConnectionSetting): Promise<void> {
    if (setting.id) {
      if (setting.dbType === "Aws" && setting.awsSetting && setting.awsSetting.sessionToken) {
        await this.storeSecret(setting.id, "sessionToken", setting.awsSetting.sessionToken);
        setting.awsSetting.sessionToken = undefined;
      }
    }
  }

  private async getSecret(key: string, paramName: SecretParamName): Promise<string | undefined> {
    return await this.secretStorage.get(`${key}+${paramName}`);
  }

  private async storeSecret(key: string, paramName: SecretParamName, value: string): Promise<void> {
    await this.secretStorage.store(`${key}+${paramName}`, value);
  }

  private async deleteSecret(key: string, paramName: SecretParamName): Promise<void> {
    await this.secretStorage.delete(`${key}+${paramName}`);
  }
}
