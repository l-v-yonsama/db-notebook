import {
  isReadOnlyEnforcementReliable,
  isReadOnlyQuery,
  RDSBaseDriver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { abbr, ResultSetData } from "@l-v-yonsama/rdh";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  MarkdownString,
  PreparedToolInvocation,
} from "vscode";
import { trackInvocation } from "../../treeData/toolActivity/ToolInvocationTracker";
import { formatConnectionEnvironmentLabel } from "../../utilities/connectionEnvironmentDisplay";
import { getDatabaseConfig } from "../../utilities/configUtil";
import { prepareAiRdhPayload } from "../../utilities/aiRdhMasking";
import { requestAiPayloadApproval } from "../../panels/AiDataMaskingPreviewPanel";
import { type AiToolOutputOptions, withConnectionMasking } from "../../utilities/aiToolOutput";
import { workflow } from "../../utilities/driverResolver";
import { getErrorMessage } from "../../utilities/errorUtil";
import { log } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";
import { formatRdhForModel } from "./resultFormatter";
import { resolveQueryConnection } from "./sqlConnectionResolver";

const PREFIX = "[lmTools/RunQueryTool]";
const LOGGED_SQL_MAX_LENGTH = 500;

export type RunQueryToolInput = {
  connectionName: string;
  sql: string;
};

type QueryRunResult = {
  ok: boolean;
  message: string;
  rdh?: ResultSetData;
  availableConnectionNames?: string[];
};

export class RunQueryTool implements LanguageModelTool<RunQueryToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<RunQueryToolInput>,
    _token: CancellationToken
  ): Promise<PreparedToolInvocation | undefined> {
    const { connectionName, sql } = options.input;
    const invocationMessage = `Running query on "${connectionName}"...`;
    const resolution = await resolveQueryConnection(this.stateStorage, connectionName);
    if (!resolution.ok) {
      // invoke() will surface the same "not found"/unsupported message; no
      // need to prompt for confirmation on a call that can't succeed anyway.
      return { invocationMessage };
    }

    // Engines where the driver's readOnly session setting isn't a reliable backstop
    // (SQL Server's routing hint, or DynamoDB which has no such session concept at
    // all) require confirmation for every statement, not just ones that look like writes.
    const alwaysConfirm = !isReadOnlyEnforcementReliable(resolution.setting.dbType);
    if (isReadOnlyQuery(sql) && !alwaysConfirm) {
      return { invocationMessage };
    }

    const reason = alwaysConfirm
      ? `Database Notebook cannot enforce read-only isolation for ${resolution.setting.dbType} connections, so every query on this connection needs confirmation.`
      : "This looks like a write/DDL statement.";
    const envLabel = formatConnectionEnvironmentLabel(resolution.setting.environment);
    const envLine = envLabel ? `**Environment:** ${envLabel}\n\n` : "";

    return {
      invocationMessage,
      confirmationMessages: {
        title: `Run SQL on "${connectionName}"?`,
        message: new MarkdownString(
          `${envLine}${reason} Review it before running against **${connectionName}**:\n\n\`\`\`sql\n${sql}\n\`\`\``
        ),
      },
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<RunQueryToolInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { connectionName, sql } = options.input;
    const text = await trackInvocation("lmTools", "RunQueryTool", options.input, () =>
      runQueryText(this.stateStorage, connectionName, sql, {
        source: "lmTool",
        cancellation: token,
      })
    );
    return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
  }
}

/**
 * Fetches, formats, logs, and error-handles a query run in one place, so every caller
 * (the Copilot Chat tool above, the MCP server's tool handler, ...) gets identical
 * behavior -- and identical logging -- without each caller repeating the same steps.
 * Never throws; failures come back as a `❌ ...` result string.
 */
export async function runQueryText(
  stateStorage: StateStorage,
  connectionName: string,
  sql: string,
  options?: AiRowOutputOptions
): Promise<string> {
  log(
    `${PREFIX} invoked connectionName:[${connectionName}] sql:[${abbr(sql, LOGGED_SQL_MAX_LENGTH)}]`
  );
  try {
    const result = await runQuery(stateStorage, connectionName, sql);
    if (!result.ok || !result.rdh) {
      const lines = [`❌ ${result.message}`];
      if (result.availableConnectionNames?.length) {
        lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
      }
      const text = lines.join("\n");
      log(`${PREFIX} result:[${lines.join(" ")}]`);
      return text;
    }
    const text = await formatAiRowOutput(
      result.rdh,
      withConnectionMasking(stateStorage, connectionName, options)
    );
    // Row data can contain PII/secrets, so only a row-count summary is logged, never the rows themselves.
    const affected = result.rdh.summary?.affectedRows;
    log(
      `${PREFIX} result: ${
        affected !== undefined
          ? `${affected} row(s) affected`
          : `${result.rdh.rows.length} row(s) returned`
      }`
    );
    return text;
  } catch (e) {
    const message = `❌ Failed to run query on "${connectionName}": ${getErrorMessage(e)}`;
    log(`${PREFIX} result:[${message}]`);
    return message;
  }
}

export type AiRowOutputOptions = AiToolOutputOptions;

export async function formatAiRowOutput(
  rdh: ResultSetData,
  options?: AiRowOutputOptions
): Promise<string> {
  const limit = getDatabaseConfig().limitRows;
  const level = options?.maskingLevel ?? 0;
  if (
    !options ||
    level === 0 ||
    (rdh.rows.length === 0 && rdh.summary?.affectedRows !== undefined)
  ) {
    return formatRdhForModel(rdh, limit);
  }
  const approved = await requestAiPayloadApproval(
    (resolutions, identity) =>
      prepareAiRdhPayload(rdh, {
        level,
        limit,
        destination: options.source,
        resolutions,
        ...identity,
      }),
    options.cancellation
  );
  return approved ?? "❌ AI result delivery was cancelled before approval.";
}

export async function runQuery(
  stateStorage: StateStorage,
  connectionName: string,
  sql: string
): Promise<QueryRunResult> {
  const resolution = await resolveQueryConnection(stateStorage, connectionName);
  if (!resolution.ok) {
    return {
      ok: false,
      message: resolution.message,
      availableConnectionNames: resolution.availableConnectionNames,
    };
  }
  const setting = resolution.setting;

  const result = await workflow<RDSBaseDriver, ResultSetData>(
    setting,
    async (driver) => {
      return await driver.requestSql({ sql });
    },
    false
  );

  if (!result.ok || !result.result) {
    return { ok: false, message: result.message || `Failed to run query on "${connectionName}".` };
  }

  return { ok: true, message: "", rdh: result.result };
}
