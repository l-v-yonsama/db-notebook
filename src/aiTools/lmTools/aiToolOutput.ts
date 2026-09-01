import type { CancellationToken } from "vscode";
import { requestAiPayloadApproval } from "../../panels/AiDataMaskingPreviewPanel";
import type { PreparedAiPayload } from "../../shared/AiDataMasking";
import { prepareAiTextPayload, type PrepareAiTextPayloadOptions } from "../../utilities/aiDataMasking";
import type { StateStorage } from "../../utilities/StateStorage";

export type AiToolOutputOptions = {
  source: "lmTool" | "mcp";
  cancellation?: CancellationToken | AbortSignal;
  maskingLevel?: 0 | 1 | 2;
};

export function withConnectionMasking(
  stateStorage: StateStorage,
  connectionName: string,
  options?: AiToolOutputOptions
): AiToolOutputOptions | undefined {
  if (!options) {
    return undefined;
  }
  return {
    ...options,
    maskingLevel: stateStorage.getAiMaskingLevelForConnection(connectionName),
  };
}

export async function approveAiTextOutput(
  rawPayload: string,
  stateStorage: StateStorage,
  connectionName: string,
  options: AiToolOutputOptions | undefined,
  inputKind: NonNullable<PrepareAiTextPayloadOptions["inputKind"]>
): Promise<string | undefined> {
  const resolved = withConnectionMasking(stateStorage, connectionName, options);
  const level = resolved?.maskingLevel ?? 0;
  if (!resolved || level === 0) {
    return rawPayload;
  }
  return await requestAiPayloadApproval(
    (resolutions, identity): PreparedAiPayload =>
      prepareAiTextPayload(rawPayload, {
        level,
        destination: resolved.source,
        inputKind,
        resolutions,
        ...identity,
      }),
    resolved.cancellation
  );
}
