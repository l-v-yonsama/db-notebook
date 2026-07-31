import { RDSBaseDriver, TransactionControlType } from "@l-v-yonsama/multi-platform-database-drivers";
import { abbr } from "@l-v-yonsama/rdh";
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
import { trackInvocation } from "../toolActivity/ToolInvocationTracker";
import { getDatabaseConfig } from "../utilities/configUtil";
import { flowTransaction } from "../utilities/driverResolver";
import { getErrorMessage } from "../utilities/errorUtil";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { formatRdhForModel } from "./resultFormatter";
import { resolveSqlOnlyConnection } from "./sqlConnectionResolver";

const PREFIX = "[lmTools/RunTransactionTool]";
const LOGGED_SQL_MAX_LENGTH = 500;

const TRANSACTION_CONTROL_TYPE_DESCRIPTIONS: Record<TransactionControlType, string> = {
  rollbackOnError:
    "Commit only if every statement succeeds; roll back everything if any statement fails. (default, recommended)",
  alwaysCommit:
    "Commit whatever ran even if a later statement fails partway through -- partial writes are kept.",
  alwaysRollback: "Always roll back, even if every statement succeeds. Useful for a dry run.",
};

export type RunTransactionToolInput = {
  connectionName: string;
  statements: string[];
  transactionControlType?: TransactionControlType;
};

type StatementOutcome = {
  sql: string;
  resultText: string;
};

type TransactionRunResult = {
  ok: boolean;
  message: string;
  completed: StatementOutcome[];
  availableConnectionNames?: string[];
};

export class RunTransactionTool implements LanguageModelTool<RunTransactionToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<RunTransactionToolInput>,
    _token: CancellationToken
  ): Promise<PreparedToolInvocation | undefined> {
    const { connectionName, statements, transactionControlType = "rollbackOnError" } = options.input;
    const invocationMessage = `Running a ${statements?.length ?? 0}-statement transaction on "${connectionName}"...`;

    const resolution = await resolveSqlOnlyConnection(this.stateStorage, connectionName);
    if (!resolution.ok || !statements?.length) {
      // invoke() will surface the same error; no need to prompt for a call that can't succeed.
      return { invocationMessage };
    }

    const numbered = statements.map((s, i) => `${i + 1}. \`\`\`sql\n${s}\n\`\`\``).join("\n");
    return {
      invocationMessage,
      confirmationMessages: {
        title: `Run ${statements.length}-statement transaction on "${connectionName}"?`,
        message: new MarkdownString(
          `This runs all statements below as one transaction against **${connectionName}**.\n\n` +
            `**Transaction mode:** \`${transactionControlType}\` -- ${TRANSACTION_CONTROL_TYPE_DESCRIPTIONS[transactionControlType]}\n\n${numbered}`
        ),
      },
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<RunTransactionToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { connectionName, statements, transactionControlType = "rollbackOnError" } = options.input;
    const text = await trackInvocation("lmTools", "RunTransactionTool", options.input, () =>
      runTransactionText(this.stateStorage, connectionName, statements, transactionControlType)
    );
    return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
  }
}

/**
 * Fetches, formats, logs, and error-handles a transaction run in one place, so every
 * caller (the Copilot Chat tool above, the MCP server's tool handler, ...) gets
 * identical behavior -- and identical logging -- without each caller repeating the
 * same steps. Never throws; failures come back as a `❌ ...` result string.
 */
export async function runTransactionText(
  stateStorage: StateStorage,
  connectionName: string,
  statements: string[],
  transactionControlType: TransactionControlType
): Promise<string> {
  log(
    `${PREFIX} invoked connectionName:[${connectionName}] statements:[${statements?.length ?? 0}] transactionControlType:[${transactionControlType}]`
  );
  try {
    if (!statements?.length) {
      return "❌ No statements were provided.";
    }
    const result = await runTransaction(stateStorage, connectionName, statements, transactionControlType);
    const lines: string[] = [];
    if (!result.ok) {
      lines.push(`❌ ${result.message}`);
      lines.push(`${result.completed.length} of ${statements.length} statement(s) completed before the failure.`);
      if (result.availableConnectionNames?.length) {
        lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
      }
    } else {
      lines.push(`✅ All ${statements.length} statement(s) completed (${transactionControlType}).`);
    }
    result.completed.forEach((s, i) => {
      lines.push(`\nStatement ${i + 1}/${statements.length}: ${abbr(s.sql, LOGGED_SQL_MAX_LENGTH)}\n${s.resultText}`);
    });
    const text = lines.join("\n");
    log(`${PREFIX} result: ${result.completed.length}/${statements.length} completed, ok:[${result.ok}]`);
    return text;
  } catch (e) {
    const message = `❌ Failed to run transaction on "${connectionName}": ${getErrorMessage(e)}`;
    log(`${PREFIX} result:[${message}]`);
    return message;
  }
}

export async function runTransaction(
  stateStorage: StateStorage,
  connectionName: string,
  statements: string[],
  transactionControlType: TransactionControlType
): Promise<TransactionRunResult> {
  const resolution = await resolveSqlOnlyConnection(stateStorage, connectionName);
  if (!resolution.ok) {
    return {
      ok: false,
      message: resolution.message,
      completed: [],
      availableConnectionNames: resolution.availableConnectionNames,
    };
  }
  const setting = resolution.setting;
  const limit = getDatabaseConfig().limitRows;
  const completed: StatementOutcome[] = [];

  const result = await flowTransaction<RDSBaseDriver, void>(
    setting,
    async (driver) => {
      for (const sql of statements) {
        const rdh = await driver.requestSql({ sql });
        completed.push({ sql, resultText: formatRdhForModel(rdh, limit) });
      }
    },
    { transactionControlType },
    false
  );

  if (!result.ok) {
    return { ok: false, message: result.message || `Transaction failed on "${connectionName}".`, completed };
  }
  return { ok: true, message: "", completed };
}
