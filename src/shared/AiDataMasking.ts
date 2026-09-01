export type AiMaskingLevel = 0 | 1 | 2;

export type AiMaskingDisposition = "unreviewed" | "masked" | "allowed";
export type AiMaskingStrategy = "partial" | "full" | "typed";

export type AiMaskingFinding = {
  id: string;
  kind: "masked" | "candidate";
  label: string;
  /** Original local value, shown only in the approval Preview and never included in payload. */
  originalText: string;
  strategy?: AiMaskingStrategy;
  disposition: AiMaskingDisposition;
  ranges: Array<{ start: number; end: number }>;
};

export type AiPayloadTruncation = {
  originalBytes: number;
  includedBytes: number;
  omittedApproxBytes: number;
};

export type PreparedAiPayload = {
  requestId: string;
  payload: string;
  payloadDigest: string;
  level: AiMaskingLevel;
  destination: "copilot" | "clipboard" | "lmTool" | "mcp";
  expiresAt: number;
  findings: AiMaskingFinding[];
  truncation?: AiPayloadTruncation;
};

export type AiPayloadFindingResolution = {
  disposition: "masked" | "allowed";
  strategy?: "partial" | "full";
};
