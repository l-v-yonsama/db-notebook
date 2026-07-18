import {
  BaseDriver,
  ConnectionSetting,
  DBType,
  SQLServerAuthenticationType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { workflow } from "../utilities/driverResolver";
import { acquireEntraIdAccessToken } from "../utilities/EntraIdAuth";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";

const PREFIX = "[lmTools/TestConnectionTool]";

export type TestConnectionToolInput = {
  connectionName: string;
};

type ConnectionTestResult = {
  connectable: boolean;
  message: string;
  availableConnectionNames?: string[];
};

export class TestConnectionTool implements LanguageModelTool<TestConnectionToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async invoke(
    options: LanguageModelToolInvocationOptions<TestConnectionToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { connectionName } = options.input;
    log(`${PREFIX} invoked connectionName:[${connectionName}]`);
    try {
      const result = await testConnectionByName(this.stateStorage, connectionName);
      const lines = [result.connectable ? `✅ ${result.message}` : `❌ ${result.message}`];
      if (result.availableConnectionNames?.length) {
        lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
      }
      const text = lines.join("\n");
      log(`${PREFIX} result:[${text}]`);
      return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
    } catch (e: any) {
      const text = `❌ Failed to test connection "${connectionName}": ${e?.message ?? e}`;
      log(`${PREFIX} result:[${text}]`);
      return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
    }
  }
}

async function testConnectionByName(
  stateStorage: StateStorage,
  connectionName: string
): Promise<ConnectionTestResult> {
  const resolution = await resolveMcpEnabledConnection(stateStorage, connectionName);
  if (!resolution.ok) {
    return {
      connectable: false,
      message: resolution.message,
      availableConnectionNames: resolution.availableConnectionNames,
    };
  }
  const setting = resolution.setting;

  if (needsInteractiveEntraIdSignIn(setting)) {
    const cachedToken = await acquireEntraIdAccessToken({
      interactive: false,
      tenantId: setting.sqlServer?.tenantId,
    });
    if (!cachedToken) {
      return {
        connectable: false,
        message: `Connection "${connectionName}" uses interactive Azure AD sign-in and has no active session. Connect to it once from the DB Explorer to sign in, then try again.`,
      };
    }
  }

  const result = await workflow<BaseDriver, string>(
    setting,
    (driver) => driver.test(false),
    false
  );
  const testMessage = result.ok ? result.result ?? "" : result.message;
  const connectable = result.ok && !testMessage;

  return {
    connectable,
    message: connectable ? `Connection "${connectionName}" is reachable.` : testMessage,
  };
}

function needsInteractiveEntraIdSignIn(setting: ConnectionSetting): boolean {
  return (
    setting.dbType === DBType.SQLServer &&
    setting.sqlServer?.authenticationType ===
      SQLServerAuthenticationType.azureActiveDirectoryAccessToken
  );
}
