// Structured AI output for performance tuning. Evidence references let users
// verify findings against the collected Full Context JSON.

import type { ComparisonAiInputDetail } from "./PerformanceTuningComparison";

/**
 * Points a finding/recommendation back at the specific piece of
 * PerformanceTuningContext it's about, so a reader can cross-check the AI's
 * claim against the Full Context JSON instead of taking it on faith. Every
 * field is optional and independent - the model fills in whichever it can
 * identify, none are required (§16.3: left fully optional pending real-world
 * observation of how well models populate this).
 */
export type PerformanceTuningAiEvidenceRef = {
  schemaName?: string;
  tableName?: string;
  indexName?: string;
  // Matches PlanTableMapping.planNodeId / PerformanceTuningDiagnosticNode.id
  // in db-drivers' PerformanceTuningContext.ts - kept as a plain string here
  // (not re-imported as a value) since this file is shared with webview-ui,
  // which never imports the driver package as a value (see
  // StatementStatisticsSortKey's local-mirror precedent, implementation plan
  // doc §"実装中に発見したbundlingの落とし穴").
  planNodeId?: string;
  // Matches PerformanceTuningDiagnosticCode, same plain-string reasoning.
  diagnosticCode?: string;
  // DynamoDB counterpart (design doc §12) - a JSON pointer-ish path into the
  // DynamoDbPerformanceTuningContext this evidence is about, e.g.
  // "/cloudWatch/series/0" or "/accessPattern". Additive and independent of
  // the RDB-shaped fields above (which have no DynamoDB equivalent - there is
  // no schema/table/index/plan-node identity to point at the same way), so
  // one shared PerformanceTuningAiAnalysisResult type still fits both
  // engines without a union.
  contextPath?: string;
};

export type PerformanceTuningAiFindingSeverity = "info" | "warning" | "critical";

export type PerformanceTuningAiFinding = {
  title: string;
  detail: string;
  severity: PerformanceTuningAiFindingSeverity;
  evidence?: PerformanceTuningAiEvidenceRef;
};

export type PerformanceTuningAiRiskLevel = "low" | "medium" | "high";

export type PerformanceTuningAiRecommendation = {
  title: string;
  detail: string;
  rationale: string;
  riskLevel?: PerformanceTuningAiRiskLevel;
  // Illustrative only (e.g. a candidate CREATE INDEX statement) - never
  // executed automatically by this feature (§1 of the design doc).
  suggestedQuery?: string;
  evidence?: PerformanceTuningAiEvidenceRef;
  // Host-computed, NOT AI-authored (2026-08-21 follow-up,
  // performanceTuningIndexDuplication.ts's findPossibleDuplicateIndex()) -
  // set by PerformanceTuningPreviewPanel.ts after the model's response is
  // parsed, by deterministically comparing suggestedQuery's CREATE INDEX
  // column set against the target table's existing indexes. Never trust
  // this field from the model's own JSON reply; it never appears there.
  // Deliberate defense-in-depth: the prompt also asks the model to
  // self-check this, but summary.md documents a real case (PostgreSQL
  // slow-03) where the model didn't - this backstop doesn't depend on the
  // model following that instruction.
  possibleDuplicateOfIndex?: string;
};

export type PerformanceTuningAiConfidence = "low" | "medium" | "high";

export type PerformanceTuningAiTokenUsage = {
  inputTokens: number;
  maxInputTokens: number;
  safetyMargin: number;
};

export type PerformanceTuningAiQualityIssue = {
  code: "SUGGESTED_QUERY_MATCHES_CURRENT";
  recommendationTitle?: string;
  message: string;
};

export type PerformanceTuningAiAnalysisResult = {
  formatVersion: 1;
  summary: string;
  findings: PerformanceTuningAiFinding[];
  recommendations: PerformanceTuningAiRecommendation[];
  // Host-computed quality failures. Recommendations listed here have already
  // been removed from `recommendations`; this evidence explains why and lets
  // both Preview and saved reports recommend trying a stronger model.
  qualityIssues?: PerformanceTuningAiQualityIssue[];
  confidence: PerformanceTuningAiConfidence;
  missingContext: string[];
  model: {
    id: string;
    vendor: string;
    family: string;
    version: string;
    name?: string;
  };
  // The exact prompt text can be reconstructed from the immutable context
  // saved alongside this result plus these options. Keeping the options with
  // the result makes a saved Notebook reproducible even when its default
  // language differs from the machine that later opens it.
  request?: {
    promptFormatVersion: 1;
    translateResponse: boolean;
    language: string;
    // Full Context JSON always remains complete in the saved notebook. This
    // records whether the request itself used the model-limit compact
    // projection, so the saved AI request messages remain reproducible.
    contextDetail: "full" | "compact";
    // Model-specific preflight measurement captured immediately before the
    // request was sent. `inputTokens` is an estimate returned by VS Code's
    // model.countTokens(); provider-side message framing may add tokens that
    // are not visible here, hence the separately recorded safety margin.
    tokenUsage?: PerformanceTuningAiTokenUsage;
    // Present only when a baseline comparison was included in the request
    // (baseline comparison implementation plan §16 Phase 3). Records which
    // rung of the shrink ladder the request actually used and exactly what
    // that rung left out, so a saved report never implies the model saw more
    // than it did (§13.1's "無言で切り捨てない").
    comparison?: {
      detail: ComparisonAiInputDetail;
      omittedFields: string[];
      baselineFileName: string;
      baselineContextSha256: string;
    };
  };
  generatedAt: string; // ISO8601, set by the extension host, not the model
};
