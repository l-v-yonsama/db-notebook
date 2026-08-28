import {
  AnyPerformanceTuningContext,
  AwsDriver,
  ConnectionSetting,
  DBType,
  DynamoDbPerformanceTuningContext,
  PerformanceTuningContext,
  RDSBaseDriver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { trackInvocation } from "../../treeData/toolActivity/ToolInvocationTracker";
import { createRDSDriver, createSQLSupportDriver, workflow } from "../../utilities/driverResolver";
import { getErrorMessage } from "../../utilities/errorUtil";
import { log } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";

const PREFIX = "[lmTools/GetPerformanceTuningContextTool]";

// Read-only tools collect estimates for RDBs and static PartiQL evidence for DynamoDB.
export type GetPerformanceTuningContextToolInput = {
  connectionName: string;
  sql: string;
  databaseName?: string;
  schemaName?: string;
};

export class GetPerformanceTuningContextTool
  implements LanguageModelTool<GetPerformanceTuningContextToolInput>
{
  constructor(private readonly stateStorage: StateStorage) {}

  async invoke(
    options: LanguageModelToolInvocationOptions<GetPerformanceTuningContextToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const text = await trackInvocation(
      "lmTools",
      "GetPerformanceTuningContextTool",
      options.input,
      () => getPerformanceTuningContextText(this.stateStorage, options.input)
    );
    return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
  }
}

/** Shared non-throwing formatter for Copilot Chat and MCP callers. */
export async function getPerformanceTuningContextText(
  stateStorage: StateStorage,
  input: GetPerformanceTuningContextToolInput
): Promise<string> {
  const { connectionName, sql, databaseName, schemaName } = input;
  log(
    `${PREFIX} invoked connectionName:[${connectionName}] databaseName:[${
      databaseName ?? ""
    }] schemaName:[${schemaName ?? ""}] sql:[${sql ? "yes" : "no"}]`
  );

  let text: string;
  try {
    const result = await fetchPerformanceTuningContext(stateStorage, input);
    text = formatPerformanceTuningContextResultForModel(result);
  } catch (e) {
    text = `❌ Failed to get performance tuning context for "${connectionName}": ${getErrorMessage(
      e
    )}`;
  }
  log(`${PREFIX} result length:[${text.length}]`);
  return text;
}

export type PerformanceTuningContextFetchResult =
  | { ok: true; context: AnyPerformanceTuningContext }
  | { ok: false; message: string; availableConnectionNames?: string[] };

export function formatPerformanceTuningContextResultForModel(
  result: PerformanceTuningContextFetchResult
): string {
  if (!result.ok) {
    const lines = [`❌ ${result.message}`];
    if (result.availableConnectionNames?.length) {
      lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
    }
    return lines.join("\n");
  }
  return JSON.stringify(result.context, null, 2);
}

async function fetchPerformanceTuningContext(
  stateStorage: StateStorage,
  input: GetPerformanceTuningContextToolInput
): Promise<PerformanceTuningContextFetchResult> {
  const { connectionName, sql, databaseName, schemaName } = input;

  if (!sql || sql.trim().length === 0) {
    return { ok: false, message: "sql must not be empty." };
  }

  const resolution = await resolveMcpEnabledConnection(stateStorage, connectionName);
  if (!resolution.ok) {
    return {
      ok: false,
      message: resolution.message,
      availableConnectionNames: resolution.availableConnectionNames,
    };
  }
  const setting = resolution.setting;

  if (setting.dbType === DBType.Aws) {
    return fetchDynamoDbPerformanceTuningContext(setting, sql);
  }

  const resolvedDatabaseName = databaseName ?? setting.database;
  if (!resolvedDatabaseName) {
    return {
      ok: false,
      message: `Connection "${connectionName}" has no default database configured, so databaseName must be provided explicitly.`,
    };
  }

  const driverForSupportCheck = await createRDSDriver<RDSBaseDriver>(setting, false);
  if (!driverForSupportCheck.supportsGetPerformanceTuningContext()) {
    return {
      ok: false,
      message: `Performance tuning context is not supported for ${setting.dbType}.`,
    };
  }

  const result = await workflow<RDSBaseDriver, PerformanceTuningContext>(
    setting,
    (driver) =>
      driver
        .getPerformanceTuningContext({
          databaseName: resolvedDatabaseName,
          schemaName,
          statement: { sql, source: "editor" },
          plan: { mode: "estimate" },
        })
        .then((r) => {
          if (!r.ok || !r.result) {
            throw new Error(r.message);
          }
          return r.result;
        }),
    false
  );

  if (!result.ok || !result.result) {
    return { ok: false, message: result.message };
  }
  return { ok: true, context: result.result };
}

// DynamoDB tools accept a PartiQL SELECT and collect static evidence only.
async function fetchDynamoDbPerformanceTuningContext(
  setting: ConnectionSetting,
  sql: string
): Promise<PerformanceTuningContextFetchResult> {
  const driverForSupportCheck = await createSQLSupportDriver<AwsDriver>(setting, false);
  if (!driverForSupportCheck.supportsGetDynamoDbPerformanceTuningContext()) {
    return {
      ok: false,
      message: `DynamoDB performance tuning context is not available for this connection.`,
    };
  }

  const result = await workflow<AwsDriver, DynamoDbPerformanceTuningContext>(
    setting,
    (driver) =>
      driver
        .getDynamoDbPerformanceTuningContext({
          statement: { source: "editor", request: { kind: "partiql", text: sql } },
        })
        .then((r) => {
          if (!r.ok || !r.result) {
            throw new Error(r.message);
          }
          return r.result;
        }),
    false
  );

  if (!result.ok || !result.result) {
    return { ok: false, message: result.message };
  }
  return { ok: true, context: result.result };
}
