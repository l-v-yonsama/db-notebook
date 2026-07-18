import { isRDSType } from "@l-v-yonsama/multi-platform-database-drivers";
import { StateStorage } from "../utilities/StateStorage";
import { McpConnectionResolution, resolveMcpEnabledConnection } from "./mcpAccessControl";

// Shared "SQL connections only" gate for RunQueryTool / RunTransactionTool.
// GetSchemaTool has its own AWS special-case branch, so it uses isRDSType directly
// instead of this function.
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
      message: `Connection "${connectionName}" is a ${resolution.setting.dbType} connection. This tool only supports SQL connections (MySQL, PostgreSQL, SQL Server, SQLite).`,
    };
  }
  return resolution;
}
