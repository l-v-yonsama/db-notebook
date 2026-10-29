import {
  DBType,
  parseRpcRequestMetadata,
  RPCDriver,
  RpcInvokeError,
  UnaryResult,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  MarkdownString,
  PreparedToolInvocation,
  window,
} from "vscode";
import { trackInvocation } from "../../treeData/toolActivity/ToolInvocationTracker";
import { formatConnectionEnvironmentLabel } from "../../utilities/connectionEnvironmentDisplay";
import { workflow } from "../../utilities/driverResolver";
import { getErrorMessage } from "../../utilities/errorUtil";
import { logError } from "../../utilities/logger";
import {
  RpcHistoryRequestCapture,
  RPC_HISTORY_REQUEST_MAX_BYTES,
} from "../../utilities/RpcHistoryRequestCapture";
import {
  RpcInvokeHistoryAttempt,
  RpcInvokeHistoryStore,
} from "../../utilities/RpcInvokeHistoryStore";
import { redactRpcToken } from "../../utilities/rpcExecution";
import { StateStorage } from "../../utilities/StateStorage";
import { AI_PAYLOAD_MAX_BYTES } from "../../utilities/aiDataMasking";
import { approveAiTextOutput, AiToolOutputOptions } from "./aiToolOutput";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";
import { resolveRpcMethod } from "./rpcMethodResolver";

export type RunRpcToolInput = {
  connectionName: string;
  serviceName: string;
  methodName: string;
  requestJson: string;
  metadata?: Record<string, string | string[]>;
};

const isCancelled = (cancellation: AiToolOutputOptions["cancellation"]): boolean =>
  cancellation !== undefined &&
  (("isCancellationRequested" in cancellation && cancellation.isCancellationRequested) ||
    ("aborted" in cancellation && cancellation.aborted));

const jsonBlock = (value: string): string => {
  const longest = Math.max(2, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}json\n${value}\n${fence}`;
};

const recordHistory = async (
  store: RpcInvokeHistoryStore,
  attempt: RpcInvokeHistoryAttempt
): Promise<boolean> => {
  try {
    await store.add(attempt);
    return true;
  } catch (error) {
    logError(`[lmTools/RunRpcTool] Could not record RPC history: ${getErrorMessage(error)}`);
    return false;
  }
};

export class RunRpcTool implements LanguageModelTool<RunRpcToolInput> {
  constructor(
    private readonly stateStorage: StateStorage,
    private readonly historyStore: RpcInvokeHistoryStore
  ) {}

  async prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<RunRpcToolInput>,
    _token: CancellationToken
  ): Promise<PreparedToolInvocation> {
    const input = options.input;
    const resolution = await resolveMcpEnabledConnection(this.stateStorage, input.connectionName);
    const environment = resolution.ok
      ? formatConnectionEnvironmentLabel(resolution.setting.environment)
      : undefined;
    return {
      invocationMessage: `Invoking ${input.serviceName}/${input.methodName}...`,
      confirmationMessages: {
        title: `Invoke RPC on "${input.connectionName}"?`,
        message: new MarkdownString(
          `Review the unary RPC request before sending it to **${input.connectionName}**. The method may modify remote state.\n\n` +
            `${environment ? `**Environment:** ${environment}\n\n` : ""}` +
            `**Method:** ${input.serviceName}/${input.methodName}\n\n` +
            `**Metadata:**\n\n${jsonBlock(JSON.stringify(input.metadata ?? {}, null, 2))}\n\n` +
            `**Data:**\n\n${jsonBlock(input.requestJson)}`
        ),
      },
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<RunRpcToolInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const input = options.input;
    const summary = {
      connectionName: input.connectionName,
      serviceName: input.serviceName,
      methodName: input.methodName,
    };
    const text = await trackInvocation("lmTools", "RunRpcTool", summary, () =>
      runRpcText(this.stateStorage, this.historyStore, input, {
        source: "lmTool",
        cancellation: token,
      })
    );
    return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
  }
}

/** Shared Copilot/MCP orchestration. A fresh driver is connected and closed by workflow. */
export async function runRpcText(
  stateStorage: StateStorage,
  historyStore: RpcInvokeHistoryStore,
  input: RunRpcToolInput,
  options: AiToolOutputOptions
): Promise<string> {
  const resolution = await resolveMcpEnabledConnection(stateStorage, input.connectionName);
  if (!resolution.ok) {
    return `❌ ${resolution.message}`;
  }
  if (resolution.setting.dbType !== DBType.RPC) {
    return `❌ "${input.connectionName}" is not an RPC connection.`;
  }
  const token =
    resolution.setting.rpc?.authentication?.type === "bearer"
      ? resolution.setting.rpc.authentication.token
      : undefined;
  const maskError = async (message: string): Promise<string> =>
    (await approveAiTextOutput(message, stateStorage, input.connectionName, options, "embedded")) ??
    "❌ AI result delivery was cancelled before approval.";
  const environment = formatConnectionEnvironmentLabel(resolution.setting.environment);
  let attempt: RpcInvokeHistoryAttempt | undefined;
  try {
    const { service, method } = await resolveRpcMethod(
      stateStorage,
      input.connectionName,
      input.serviceName,
      input.methodName
    );
    if (method.requestStream || method.responseStream) {
      return "❌ Direct AI invocation supports unary RPC methods only. Use an rpc-json notebook cell for streaming.";
    }
    if (Buffer.byteLength(input.requestJson, "utf8") > RPC_HISTORY_REQUEST_MAX_BYTES) {
      return `❌ Request exceeds the ${RPC_HISTORY_REQUEST_MAX_BYTES}-byte AI invocation limit.`;
    }
    const body: unknown = JSON.parse(input.requestJson);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return "❌ Unary RPC Data must be a JSON object.";
    }
    const metadata = parseRpcRequestMetadata(input.metadata);
    const capture = new RpcHistoryRequestCapture(false);
    capture.add(input.requestJson);
    if (isCancelled(options.cancellation)) {
      return "❌ RPC invocation cancelled.";
    }
    if (options.source === "mcp") {
      const answer = await window.showWarningMessage(
        `Invoke ${service.fullName}/${method.name} on ${input.connectionName}?`,
        {
          modal: true,
          detail: `This unary RPC may modify remote state.${
            environment ? `\nEnvironment: ${environment}` : ""
          }\n\nMetadata:\n${JSON.stringify(metadata, null, 2)}\n\nData:\n${input.requestJson}`,
        },
        "Invoke RPC"
      );
      if (answer !== "Invoke RPC") {
        return "❌ RPC invocation cancelled before sending.";
      }
    }
    if (isCancelled(options.cancellation)) {
      return "❌ RPC invocation cancelled before sending.";
    }
    attempt = {
      startedAt: Date.now(),
      connectionName: input.connectionName,
      service: service.fullName,
      method: method.name,
      path: method.path,
      callKind: "unary",
      totalElapsedMs: 0,
      sentCount: 0,
      receivedCount: 0,
      outcome: "error",
      requestCapture: capture,
      ...(Object.keys(metadata).length ? { requestMetadata: metadata } : {}),
    };
    let sent = false;
    let invokeError: RpcInvokeError | undefined;
    const response = await workflow<RPCDriver, UnaryResult<unknown>>(
      resolution.setting,
      async (driver) => {
        sent = true;
        try {
          return await driver.invokeUnaryProtoJson({
            service: service.fullName,
            method: method.name,
            requestJson: input.requestJson,
            metadata,
          });
        } catch (error) {
          if (error instanceof RpcInvokeError) invokeError = error;
          throw error;
        }
      },
      false
    );
    attempt.totalElapsedMs = Date.now() - attempt.startedAt;
    attempt.sentCount = sent ? 1 : 0;
    attempt.receivedCount = response.ok && response.result ? 1 : 0;
    if (invokeError?.status) {
      attempt.grpcStatus = { code: invokeError.status.code, name: invokeError.status.name };
      attempt.outcome = invokeError.status.code === 4 ? "timeout" : "error";
    }
    if (response.ok && response.result) {
      attempt.outcome = "success";
      attempt.grpcStatus = { code: response.result.status.code, name: response.result.status.name };
    }
    const completedAttempt = attempt;
    attempt = undefined;
    const historyRecorded = await recordHistory(historyStore, completedAttempt);
    if (!response.ok || !response.result) {
      return maskError(
        `❌ RPC invocation failed: ${redactRpcToken(response.message, token)}${
          historyRecorded ? "" : " (History could not be saved.)"
        }`
      );
    }
    const result = response.result;
    const raw = JSON.stringify(
      {
        status: { code: result.status.code, name: result.status.name },
        elapsedMs: result.elapsedMs,
        data: result.contents,
        ...(!historyRecorded ? { historyWarning: "History could not be saved." } : {}),
      },
      null,
      2
    );
    if (Buffer.byteLength(raw, "utf8") > AI_PAYLOAD_MAX_BYTES) {
      return `RPC completed with ${result.status.name}(${result.status.code}) in ${result.elapsedMs} ms, but the response exceeds the ${AI_PAYLOAD_MAX_BYTES}-byte AI output limit. Inspect it in an RPC notebook cell.`;
    }
    return (
      (await approveAiTextOutput(raw, stateStorage, input.connectionName, options, "json")) ??
      "❌ AI result delivery was cancelled before approval."
    );
  } catch (error) {
    if (attempt) {
      attempt.totalElapsedMs = Date.now() - attempt.startedAt;
      await recordHistory(historyStore, attempt);
    }
    return maskError(`❌ RPC invocation failed: ${redactRpcToken(getErrorMessage(error), token)}`);
  }
}
