import {
  AwsServiceType,
  BaseDriver,
  createSchemaDefinitionsForPrompt,
  DBType,
  isRDSType,
  RDSBaseDriver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { MqttDriverManager } from "../../mqtt/MqttDriverManager";
import { trackInvocation } from "../../treeData/toolActivity/ToolInvocationTracker";
import { workflow } from "../../utilities/driverResolver";
import { getErrorMessage } from "../../utilities/errorUtil";
import { log } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";

const PREFIX = "[lmTools/GetSchemaTool]";

export type GetSchemaToolInput = {
  connectionName: string;
  // SQL connections only.
  schemaName?: string;
  tableName?: string;
  // AWS connections only.
  serviceType?: AwsServiceType;
  resourceName?: string;
  // Keycloak connections only.
  realmName?: string;
};

type SchemaFetchResult = {
  ok: boolean;
  message: string;
  schemaText?: string;
  availableConnectionNames?: string[];
};

export class GetSchemaTool implements LanguageModelTool<GetSchemaToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async invoke(
    options: LanguageModelToolInvocationOptions<GetSchemaToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { connectionName, schemaName, tableName, serviceType, resourceName, realmName } =
      options.input;
    const text = await trackInvocation("lmTools", "GetSchemaTool", options.input, () =>
      getSchemaText(this.stateStorage, connectionName, {
        schemaName,
        tableName,
        serviceType,
        resourceName,
        realmName,
      })
    );
    return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
  }
}

/**
 * Fetches, formats, logs, and error-handles a schema lookup in one place, so every
 * caller (the Copilot Chat tool above, the MCP server's tool handler, ...) gets
 * identical behavior -- and identical logging -- without each caller repeating the
 * same steps. Never throws; failures come back as a `❌ ...` result string, same as
 * `formatSchemaResultForModel` already does for an `ok: false` result.
 */
export async function getSchemaText(
  stateStorage: StateStorage,
  connectionName: string,
  filters: GetSchemaFilters
): Promise<string> {
  const { schemaName, tableName, serviceType, resourceName, realmName } = filters;
  log(
    `${PREFIX} invoked connectionName:[${connectionName}] schemaName:[${
      schemaName ?? ""
    }] tableName:[${tableName ?? ""}] serviceType:[${serviceType ?? ""}] resourceName:[${
      resourceName ?? ""
    }] realmName:[${realmName ?? ""}]`
  );
  let text: string;
  try {
    const result = await getSchemaInfo(stateStorage, connectionName, filters);
    text = formatSchemaResultForModel(result);
  } catch (e) {
    text = `❌ Failed to get schema for "${connectionName}": ${getErrorMessage(e)}`;
  }
  log(`${PREFIX} result:[${text}]`);
  return text;
}

export function formatSchemaResultForModel(result: SchemaFetchResult): string {
  const lines = [result.ok ? result.schemaText ?? "" : `❌ ${result.message}`];
  if (!result.ok && result.availableConnectionNames?.length) {
    lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
  }
  return lines.join("\n");
}

export type GetSchemaFilters = {
  schemaName?: string;
  tableName?: string;
  serviceType?: AwsServiceType;
  resourceName?: string;
  realmName?: string;
};

/**
 * Fetches schema (or schema-like) text for a connection regardless of its
 * dbType, via the single `createSchemaDefinitionsForPrompt` dispatcher -
 * which internally routes to the right vendor-specific renderer based on
 * the runtime type of the resolved resource tree.
 */
export async function getSchemaInfo(
  stateStorage: StateStorage,
  connectionName: string,
  { schemaName, tableName, serviceType, resourceName, realmName }: GetSchemaFilters
): Promise<SchemaFetchResult> {
  const resolution = await resolveMcpEnabledConnection(stateStorage, connectionName);
  if (!resolution.ok) {
    return {
      ok: false,
      message: resolution.message,
      availableConnectionNames: resolution.availableConnectionNames,
    };
  }
  const setting = resolution.setting;

  const dbType = stateStorage.getDBTypeByConnectionName(connectionName);
  if (dbType === DBType.Mqtt) {
    // 購読状態を正しく返すには、MqttDriverManagerを使って接続する必要がある
    const manager = MqttDriverManager.getInstance(setting);
    const databases = await manager.getInfomationSchemas();
    if (databases && databases.length > 0) {
      const text = await createSchemaDefinitionsForPrompt({
        db: databases,
        rdsDriver: undefined,
        schemaName,
        tableName,
        resourceName,
        serviceType,
        realmName,
      });
      if (text) {
        return { ok: true, message: "", schemaText: text };
      }
    }
  }

  const result = await workflow<BaseDriver, string>(
    setting,
    async (driver) => {
      const databases = await driver.getInfomationSchemas();
      const rdsDriver = driver instanceof RDSBaseDriver ? driver : undefined;
      const text = await createSchemaDefinitionsForPrompt({
        db: databases,
        rdsDriver,
        schemaName,
        tableName,
        resourceName,
        serviceType,
        realmName,
      });
      return text ?? "";
    },
    false
  );

  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  if (!result.result) {
    return {
      ok: false,
      message: buildNotFoundMessage(stateStorage, connectionName, {
        schemaName,
        tableName,
        resourceName,
        serviceType,
        realmName,
      }),
    };
  }
  return { ok: true, message: "", schemaText: result.result };
}

function buildNotFoundMessage(
  stateStorage: StateStorage,
  connectionName: string,
  { schemaName, tableName, resourceName, serviceType, realmName }: GetSchemaFilters
): string {
  const dbType = stateStorage.getDBTypeByConnectionName(connectionName);

  if (dbType && isRDSType(dbType)) {
    if (tableName) {
      return `No table named "${tableName}"${
        schemaName ? ` in schema "${schemaName}"` : ""
      } was found on connection "${connectionName}".`;
    }
    return schemaName
      ? `No tables were found in schema "${schemaName}" on connection "${connectionName}".`
      : `No tables were found on connection "${connectionName}".`;
  }

  if (dbType === DBType.Aws) {
    if (resourceName) {
      return `No AWS resource named "${resourceName}"${
        serviceType ? ` for service "${serviceType}"` : ""
      } was found on connection "${connectionName}".`;
    }
    return serviceType
      ? `No AWS resources were found for service "${serviceType}" on connection "${connectionName}".`
      : `No AWS resources were found on connection "${connectionName}". Check that the connection has services configured.`;
  }

  if (dbType === DBType.Keycloak) {
    return realmName
      ? `No realm named "${realmName}" was found on connection "${connectionName}".`
      : `No realms were found on connection "${connectionName}".`;
  }

  return `No schema/resource information was found for connection "${connectionName}"${
    dbType ? ` (${dbType})` : ""
  }.`;
}
