import {
  RDSBaseDriver,
  TransactionControlType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { abbr, ResultSetData } from "@l-v-yonsama/rdh";
import { createHash } from "crypto";
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
import { requestAiPayloadApproval } from "../../panels/AiDataMaskingPreviewPanel";
import type {
  AiMaskingFinding,
  AiPayloadFindingResolution,
  PreparedAiPayload,
} from "../../shared/AiDataMasking";
import {
  AI_PAYLOAD_MAX_BYTES,
  AI_UNMASKED_DATA_GUIDANCE_LINES,
  prepareAiTextPayload,
} from "../../utilities/aiDataMasking";
import { prepareAiRdhPayload } from "./aiRdhMasking";
import { type AiToolOutputOptions, withConnectionMasking } from "./aiToolOutput";
import { getDatabaseConfig } from "../../utilities/configUtil";
import { formatConnectionEnvironmentLabel } from "../../utilities/connectionEnvironmentDisplay";
import { flowTransaction } from "../../utilities/driverResolver";
import { getErrorMessage } from "../../utilities/errorUtil";
import { log } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";
import { formatAiRowOutput } from "./RunQueryTool";
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

export type StatementOutcome = {
  sql: string;
  rdh: ResultSetData;
};

export type TransactionRunResult = {
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
    const {
      connectionName,
      statements,
      transactionControlType = "rollbackOnError",
    } = options.input;
    const invocationMessage = `Running a ${
      statements?.length ?? 0
    }-statement transaction on "${connectionName}"...`;

    const resolution = await resolveSqlOnlyConnection(this.stateStorage, connectionName);
    if (!resolution.ok || !statements?.length) {
      // invoke() will surface the same error; no need to prompt for a call that can't succeed.
      return { invocationMessage };
    }

    const numbered = statements.map((s, i) => `${i + 1}. \`\`\`sql\n${s}\n\`\`\``).join("\n");
    const envLabel = formatConnectionEnvironmentLabel(resolution.setting.environment);
    const envLine = envLabel ? `**Environment:** ${envLabel}\n\n` : "";
    return {
      invocationMessage,
      confirmationMessages: {
        title: `Run ${statements.length}-statement transaction on "${connectionName}"?`,
        message: new MarkdownString(
          `${envLine}This runs all statements below as one transaction against **${connectionName}**.\n\n` +
            `**Transaction mode:** \`${transactionControlType}\` -- ${TRANSACTION_CONTROL_TYPE_DESCRIPTIONS[transactionControlType]}\n\n${numbered}`
        ),
      },
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<RunTransactionToolInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const {
      connectionName,
      statements,
      transactionControlType = "rollbackOnError",
    } = options.input;
    const text = await trackInvocation("lmTools", "RunTransactionTool", options.input, () =>
      runTransactionText(this.stateStorage, connectionName, statements, transactionControlType, {
        source: "lmTool",
        cancellation: token,
      })
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
  transactionControlType: TransactionControlType,
  options?: AiToolOutputOptions
): Promise<string> {
  log(
    `${PREFIX} invoked connectionName:[${connectionName}] statements:[${
      statements?.length ?? 0
    }] transactionControlType:[${transactionControlType}]`
  );
  try {
    if (!statements?.length) {
      return "❌ No statements were provided.";
    }
    const result = await runTransaction(
      stateStorage,
      connectionName,
      statements,
      transactionControlType
    );
    const lines: string[] = [];
    if (!result.ok) {
      lines.push(`❌ ${result.message}`);
      lines.push(
        `${result.completed.length} of ${statements.length} statement(s) completed before the failure.`
      );
      if (result.availableConnectionNames?.length) {
        lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
      }
    } else {
      lines.push(`✅ All ${statements.length} statement(s) completed (${transactionControlType}).`);
    }
    const resolvedOptions = withConnectionMasking(stateStorage, connectionName, options);
    if (resolvedOptions && resolvedOptions.maskingLevel && result.completed.length > 0) {
      const level = resolvedOptions.maskingLevel;
      const approved = await requestAiPayloadApproval(
        (resolutions, identity) =>
          prepareTransactionPayload(
            result,
            statements.length,
            lines,
            level,
            resolvedOptions.source,
            resolutions,
            identity
          ),
        resolvedOptions.cancellation
      );
      if (approved === undefined) {
        return "❌ AI result delivery was cancelled before approval.";
      }
      log(
        `${PREFIX} result: ${result.completed.length}/${statements.length} completed, ok:[${result.ok}]`
      );
      return approved;
    }
    for (let i = 0; i < result.completed.length; i += 1) {
      const s = result.completed[i];
      const resultText = await formatAiRowOutput(s.rdh);
      lines.push(
        `\nStatement ${i + 1}/${statements.length}: ${abbr(
          s.sql,
          LOGGED_SQL_MAX_LENGTH
        )}\n${resultText}`
      );
    }
    const text = lines.join("\n");
    log(
      `${PREFIX} result: ${result.completed.length}/${statements.length} completed, ok:[${result.ok}]`
    );
    return text;
  } catch (e) {
    const message = `❌ Failed to run transaction on "${connectionName}": ${getErrorMessage(e)}`;
    log(`${PREFIX} result:[${message}]`);
    return message;
  }
}

export function prepareTransactionPayload(
  result: TransactionRunResult,
  statementCount: number,
  prefixLines: string[],
  level: 1 | 2,
  destination: PreparedAiPayload["destination"],
  resolutions: ReadonlyMap<string, AiPayloadFindingResolution>,
  identity: { requestId: string; expiresAt: number }
): PreparedAiPayload {
  let payload = prefixLines.join("\n");
  const findings: AiMaskingFinding[] = [];
  result.completed.forEach((statement, index) => {
    const displayedSql = abbr(statement.sql, LOGGED_SQL_MAX_LENGTH) ?? "";
    const preparedSql = prepareAiTextPayload(displayedSql, {
      level,
      destination,
      inputKind: "sql",
      includeNote: false,
      resolutions,
      idScope: `transaction-sql-${index}`,
      ...identity,
    });
    const headingPrefix = `\n\nStatement ${index + 1}/${statementCount}: `;
    const sqlOffset = payload.length + headingPrefix.length;
    payload += headingPrefix + preparedSql.payload + "\n";
    preparedSql.findings.forEach((finding) => {
      findings.push({
        ...finding,
        ranges: finding.ranges.map((range) => ({
          start: range.start + sqlOffset,
          end: range.end + sqlOffset,
        })),
      });
    });

    const preparedRows = prepareAiRdhPayload(statement.rdh, {
      level,
      destination,
      limit: getDatabaseConfig().limitRows,
      resolutions,
      idScope: `statement-${index}`,
      ...identity,
    });
    const rowOffset = payload.length;
    payload += preparedRows.payload;
    preparedRows.findings.forEach((finding) => {
      findings.push({
        ...finding,
        ranges: finding.ranges.map((range) => ({
          start: range.start + rowOffset,
          end: range.end + rowOffset,
        })),
      });
    });
  });

  const maskedCount = findings.filter((finding) => finding.disposition === "masked").length;
  const candidateCount = findings.filter((finding) => finding.disposition === "unreviewed").length;
  const note = [
    "NOTE: Database Notebook processed this transaction output with best-effort AI data masking.",
    `Masking level: ${level}. Masked findings: ${maskedCount}. Unreviewed candidates: ${candidateCount}.`,
    "Do not infer or reconstruct masked values. Unmarked values are not guaranteed to be non-sensitive.",
    ...AI_UNMASKED_DATA_GUIDANCE_LINES,
    "",
    "",
  ].join("\n");
  payload = note + payload;
  findings.forEach((finding) => {
    finding.ranges = finding.ranges.map((range) => ({
      start: range.start + note.length,
      end: range.end + note.length,
    }));
  });

  const originalBytes = Buffer.byteLength(payload, "utf8");
  let truncation: PreparedAiPayload["truncation"];
  if (originalBytes > AI_PAYLOAD_MAX_BYTES) {
    const suffix =
      "\n\n[TRUNCATED: additional transaction results were omitted to keep the AI payload within 1 MiB.]";
    const budget = AI_PAYLOAD_MAX_BYTES - Buffer.byteLength(suffix, "utf8");
    let included = "";
    for (const line of payload.split(/(?<=\n)/)) {
      if (Buffer.byteLength(included + line, "utf8") > budget) {
        break;
      }
      included += line;
    }
    payload = included + suffix;
    truncation = {
      originalBytes,
      includedBytes: Buffer.byteLength(payload, "utf8"),
      omittedApproxBytes: Math.max(0, originalBytes - Buffer.byteLength(included, "utf8")),
    };
  }
  const visibleFindings = findings.filter((finding) => finding.ranges[0]?.end <= payload.length);
  return {
    requestId: identity.requestId,
    payload,
    payloadDigest: createHash("sha256").update(payload).digest("hex"),
    level,
    destination,
    expiresAt: identity.expiresAt,
    findings: visibleFindings,
    truncation,
  };
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
  const completed: StatementOutcome[] = [];

  const result = await flowTransaction<RDSBaseDriver, void>(
    setting,
    async (driver) => {
      for (const sql of statements) {
        const rdh = await driver.requestSql({ sql });
        completed.push({ sql, rdh });
      }
    },
    { transactionControlType },
    false
  );

  if (!result.ok) {
    return {
      ok: false,
      message: result.message || `Transaction failed on "${connectionName}".`,
      completed,
    };
  }
  return { ok: true, message: "", completed };
}
