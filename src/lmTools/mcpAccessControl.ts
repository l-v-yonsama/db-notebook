import { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { StateStorage } from "../utilities/StateStorage";

export type McpConnectionResolution =
  | { ok: true; setting: ConnectionSetting }
  | { ok: false; message: string; availableConnectionNames?: string[] };

/**
 * Resolves a connection by name for use by an AI-facing tool, enforcing the
 * per-connection mcpEnabled opt-in. A connection that exists but is not
 * mcp-enabled is reported identically to one that doesn't exist at all, so
 * AI tools cannot discover connections the user has not explicitly allowed.
 */
export async function resolveMcpEnabledConnection(
  stateStorage: StateStorage,
  connectionName: string
): Promise<McpConnectionResolution> {
  const setting = await stateStorage.getConnectionSettingByName(connectionName);
  const availableConnectionNames = stateStorage
    .getConnectionSettingNames()
    .filter((name) => stateStorage.isMcpEnabledForConnection(name));

  if (!setting || !stateStorage.isMcpEnabledForConnection(connectionName)) {
    return {
      ok: false,
      message: `No connection named "${connectionName}" was found.`,
      availableConnectionNames,
    };
  }
  return { ok: true, setting };
}
