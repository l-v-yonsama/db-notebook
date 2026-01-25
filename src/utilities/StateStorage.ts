import {
  Auth0Database,
  AwsDatabase,
  ConnectionSetting,
  DBDriverResolver,
  DBType,
  DbDatabase,
  DbDynamoTable,
  DbLogGroup,
  DbS3Bucket,
  DbSQSQueue,
  DbSchema,
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
import { SQLHistory } from "../types/SQLHistory";
import { log } from "./logger";

const uid = new ShortUniqueId();

const PREFIX = "[StateStorage]";

export const DEFAULT_CON_NAME_KEY = `${EXTENSION_NAME}-DEFAULT-CON-NAME`;
export const STORAGE_KEY = `${EXTENSION_NAME}-settings`;
export const SQL_HISTORY_STORAGE_KEY = `${EXTENSION_NAME}-sql-history`;
export const PREV_SAVE_FOLDER = `${EXTENSION_NAME}-previous-save-folder`;

type DbResInfo = {
  isInProgress: boolean;
  res?: DbDatabase[];
};

type SecretParamName = "password" | "clientSecret";

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

    const { ok, message, result } = await DBDriverResolver.getInstance().workflow(
      conRes,
      async (driver) => await driver.getInfomationSchemas()
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

  async getSQLHistoryList(): Promise<SQLHistory[]> {
    return this.context.globalState.get<SQLHistory[]>(SQL_HISTORY_STORAGE_KEY, []);
  }

  async addSQLHistory(history: Omit<SQLHistory, "id">): Promise<boolean> {
    const list = await this.getSQLHistoryList();

    const newTrimedSql = history.sqlDoc.trim();
    const sameHistoryIndex = list.findIndex(
      (it) => it.sqlDoc.trim() === newTrimedSql && it.connectionName === history.connectionName
    );
    if (sameHistoryIndex >= 0) {
      list.splice(sameHistoryIndex, 1, { ...history, id: uid.randomUUID(8) });
      await this.context.globalState.update(SQL_HISTORY_STORAGE_KEY, list);
      return false;
    }

    list.unshift({ ...history, id: uid.randomUUID(8) });

    const maxHistory = 50;
    // 5: 5, 5-5=0
    // 6:, 5, 6-5=1
    if (list.length > maxHistory) {
      list.splice(maxHistory, list.length - maxHistory);
    }
    await this.context.globalState.update(SQL_HISTORY_STORAGE_KEY, list);
    return true;
  }

  async deleteSQLHistoryByID(id: string): Promise<boolean> {
    const list = await this.getSQLHistoryList();
    const idx = list.findIndex((it) => it.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      await this.context.globalState.update(SQL_HISTORY_STORAGE_KEY, list);
      return true;
    }
    return false;
  }

  async deleteAllSQLHistories(): Promise<boolean> {
    await this.context.globalState.update(SQL_HISTORY_STORAGE_KEY, []);
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
      }
    }
    return list;
  }

  getPasswordlessConnectionSettingList(): ConnectionSetting[] {
    return this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
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

  getDBTypeByConnectionName(name: string): DBType | undefined {
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    const setting = list.find((it) => it.name === name);
    return setting?.dbType;
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
    }
    await this.context.globalState.update(STORAGE_KEY, list);
    this.resMap.delete(name);
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
