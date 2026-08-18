import {
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
import { createRDSDriver, workflow } from "../../utilities/driverResolver";
import { getErrorMessage } from "../../utilities/errorUtil";
import { log } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";

const PREFIX = "[lmTools/GetPerformanceTuningContextTool]";

// (B) of misc/design/performance-tuning-structured-ai-analysis-plan.ja.md
// §4/§9. Read-only data feed for a conversational agent (Copilot Chat or an
// MCP client) - this tool never calls an AI model itself (no nested LM call);
// it just returns the same PerformanceTuningContext JSON the Preview Panel
// shows, so the *calling* model can reason about it in its own turn. `mode`
// is hardcoded to 'estimate' and `binds`/`allowExecution` are not accepted as
// input: unlike runDbQuery, there is no write-confirmation dialog here, and
// 'analyze' mode actually executes the SQL - not appropriate for a tool
// described as read-only (§9).
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

/**
 * Fetches, formats, logs, and error-handles a performance tuning context
 * lookup in one place, so both callers (the Copilot Chat tool above and the
 * MCP server's tool handler) get identical behavior - same shared-
 * orchestrator pattern as GetSchemaTool.getSchemaText(). Never throws;
 * failures come back as a `❌ ...` result string.
 */
export async function getPerformanceTuningContextText(
  stateStorage: StateStorage,
  input: GetPerformanceTuningContextToolInput
): Promise<string> {
  const { connectionName, sql, databaseName, schemaName } = input;
  log(
    `${PREFIX} invoked connectionName:[${connectionName}] databaseName:[${databaseName ?? ""}] schemaName:[${
      schemaName ?? ""
    }] sql:[${sql ? "yes" : "no"}]`
  );

  let text: string;
  try {
    const result = await fetchPerformanceTuningContext(stateStorage, input);
    text = formatPerformanceTuningContextResultForModel(result);
  } catch (e) {
    text = `❌ Failed to get performance tuning context for "${connectionName}": ${getErrorMessage(e)}`;
  }
  log(`${PREFIX} result length:[${text.length}]`);
  return text;
}

export type PerformanceTuningContextFetchResult =
  | { ok: true; context: PerformanceTuningContext }
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
