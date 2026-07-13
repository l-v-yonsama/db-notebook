import {
  BaseDriver,
  BaseSQLSupportDriver,
  ConnectionSetting,
  DBDriverResolver,
  DBType,
  GeneralResult,
  RDSBaseDriver,
  SQLServerAuthenticationType,
  TransactionControlType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { acquireEntraIdAccessToken } from "./EntraIdAuth";

async function resolveConnectionSetting(
  setting: ConnectionSetting,
  interactive: boolean
): Promise<ConnectionSetting> {
  if (
    setting.dbType === DBType.SQLServer &&
    setting.sqlServer?.authenticationType ===
      SQLServerAuthenticationType.azureActiveDirectoryAccessToken
  ) {
    const tenantId = setting.sqlServer.tenantId ? setting.sqlServer.tenantId : undefined;
    const token = await acquireEntraIdAccessToken({
      interactive,
      tenantId,
    });
    if (!token) {
      return setting;
    }
    return {
      ...setting,
      sqlServer: { ...setting.sqlServer, token },
    };
  }
  return setting;
}

export async function createDriver<T extends BaseDriver>(
  setting: ConnectionSetting,
  interactive: boolean
): Promise<T> {
  const resolved = await resolveConnectionSetting(setting, interactive);
  return DBDriverResolver.getInstance().createDriver<T>(resolved);
}

export async function createRDSDriver<T extends RDSBaseDriver>(
  setting: ConnectionSetting,
  interactive: boolean
): Promise<T> {
  const resolved = await resolveConnectionSetting(setting, interactive);
  return DBDriverResolver.getInstance().createRDSDriver<T>(resolved);
}

export async function createSQLSupportDriver<T extends BaseSQLSupportDriver>(
  setting: ConnectionSetting,
  interactive: boolean
): Promise<T> {
  const resolved = await resolveConnectionSetting(setting, interactive);
  return DBDriverResolver.getInstance().createSQLSupportDriver<T>(resolved);
}

export async function workflow<T extends BaseDriver, U = any>(
  setting: ConnectionSetting,
  f: (driver: T) => Promise<U>,
  interactive: boolean
): Promise<GeneralResult<U>> {
  const resolved = await resolveConnectionSetting(setting, interactive);
  return DBDriverResolver.getInstance().workflow<T, U>(resolved, f);
}

export async function flowTransaction<T extends RDSBaseDriver, U = any>(
  setting: ConnectionSetting,
  f: (driver: T) => Promise<U>,
  options: { transactionControlType: TransactionControlType } | undefined,
  interactive: boolean
): Promise<GeneralResult<U>> {
  const resolved = await resolveConnectionSetting(setting, interactive);
  return DBDriverResolver.getInstance().flowTransaction<T, U>(resolved, f, options);
}
