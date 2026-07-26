import { isPartiQLType, isRDSType } from "@l-v-yonsama/multi-platform-database-drivers";
import { StateStorage } from "../utilities/StateStorage";
import { McpConnectionResolution, resolveMcpEnabledConnection } from "./mcpAccessControl";

// "SQL connections only" gate for RunTransactionTool -- transactions (begin/commit/rollback)
// are only implemented on RDSBaseDriver subclasses; AwsDriver (DynamoDB) has none of those
// methods, so a DynamoDB connection must not reach flowTransaction. GetSchemaTool has its own
// AWS special-case branch, so it uses isRDSType directly instead of this function.
export async function resolveSqlOnlyConnection(
  stateStorage: StateStorage,
  connectionName: string
): Promise<McpConnectionResolution> {
  const resolution = await resolveMcpEnabledConnection(stateStorage, connectionName);
  if (!resolution.ok) {
    return resolution;
  }
  if (!isRDSType(resolution.setting.dbType)) {
    return {
      ok: false,
      message: `Connection "${connectionName}" is a ${resolution.setting.dbType} connection. This tool only supports SQL connections (MySQL, PostgreSQL, SQL Server, SQLite, Oracle).`,
    };
  }
  return resolution;
}

// Gate for RunQueryTool: a single ad-hoc statement, not a transaction, so it can additionally
// accept an AWS connection configured for DynamoDB (driver.requestSql runs it as PartiQL) --
// same isRDSType-or-isPartiQLType check DBDriverResolver.createSQLSupportDriver itself uses to
// decide whether a connection can run driver.requestSql() at all.
export async function resolveQueryConnection(
  stateStorage: StateStorage,
  connectionName: string
): Promise<McpConnectionResolution> {
  const resolution = await resolveMcpEnabledConnection(stateStorage, connectionName);
  if (!resolution.ok) {
    return resolution;
  }
  const { dbType, awsSetting } = resolution.setting;
  if (!isRDSType(dbType) && !isPartiQLType(dbType, awsSetting)) {
    return {
      ok: false,
      message: `Connection "${connectionName}" is a ${dbType} connection. This tool only supports SQL connections (MySQL, PostgreSQL, SQL Server, SQLite, Oracle) or an AWS connection configured for DynamoDB (PartiQL).`,
    };
  }
  return resolution;
}
