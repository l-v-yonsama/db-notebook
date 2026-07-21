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
import { getDatabaseConfig } from "../utilities/configUtil";
import { workflow } from "../utilities/driverResolver";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { formatRdhForModel } from "./resultFormatter";
import { resolveSqlOnlyConnection } from "./sqlConnectionResolver";

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
    const resolution = await resolveSqlOnlyConnection(this.stateStorage, connectionName);
    if (!resolution.ok) {
      // invoke() will surface the same "not found"/unsupported message; no
      // need to prompt for confirmation on a call that can't succeed anyway.
      return { invocationMessage };
    }

    // Engines where the driver's readOnly session setting isn't a reliable backstop
    // (currently just SQL Server's routing hint) require confirmation for every
    // statement, not just ones that look like writes.
    const alwaysConfirm = !isReadOnlyEnforcementReliable(resolution.setting.dbType);
    if (isReadOnlyQuery(sql) && !alwaysConfirm) {
      return { invocationMessage };
    }

    const reason = alwaysConfirm
      ? "Database Notebook cannot enforce read-only isolation for SQL Server connections, so every query on this connection needs confirmation."
      : "This looks like a write/DDL statement.";

    return {
      invocationMessage,
      confirmationMessages: {
        title: `Run SQL on "${connectionName}"?`,
        message: new MarkdownString(
          `${reason} Review it before running against **${connectionName}**:\n\n\`\`\`sql\n${sql}\n\`\`\``
        ),
      },
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<RunQueryToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { connectionName, sql } = options.input;
    log(`${PREFIX} invoked connectionName:[${connectionName}] sql:[${abbr(sql, LOGGED_SQL_MAX_LENGTH)}]`);
    try {
      const result = await runQuery(this.stateStorage, connectionName, sql);
      if (!result.ok || !result.rdh) {
        const lines = [`❌ ${result.message}`];
        if (result.availableConnectionNames?.length) {
          lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
        }
        log(`${PREFIX} result:[${lines.join(" ")}]`);
        return new LanguageModelToolResult([new LanguageModelTextPart(lines.join("\n"))]);
      }
      const text = formatRdhForModel(result.rdh, getDatabaseConfig().limitRows);
      // Row data can contain PII/secrets, so only a row-count summary is logged, never the rows themselves.
      const affected = result.rdh.summary?.affectedRows;
      log(
        `${PREFIX} result: ${affected !== undefined ? `${affected} row(s) affected` : `${result.rdh.rows.length} row(s) returned`}`
      );
      return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
    } catch (e: any) {
      const message = `❌ Failed to run query on "${connectionName}": ${e?.message ?? e}`;
      log(`${PREFIX} result:[${message}]`);
      return new LanguageModelToolResult([new LanguageModelTextPart(message)]);
    }
  }
}

async function runQuery(
  stateStorage: StateStorage,
  connectionName: string,
  sql: string
): Promise<QueryRunResult> {
  const resolution = await resolveSqlOnlyConnection(stateStorage, connectionName);
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
