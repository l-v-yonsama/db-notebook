import { EstimatedBindParameter } from "@l-v-yonsama/multi-platform-database-drivers";
import { PerformanceTuningBindParametersPanel } from "../../panels/PerformanceTuningBindParametersPanel";
import {
  StartDynamoDbPerformanceTuningPreviewParams,
  StartDynamoDbPerformanceTuningPreviewResult,
  startDynamoDbPerformanceTuningPreview,
} from "./dynamoDbPerformanceTuningPreview";
import {
  StartPerformanceTuningPreviewParams,
  StartPerformanceTuningPreviewResult,
  startPerformanceTuningPreview,
} from "./performanceTuningPreview";

// 2026-08-19 follow-up . Both Preview entry points
// (Query Statistics' "Preview tuning data" and Query History's
// histories.startPerformanceTuning) call this instead of
// startPerformanceTuningPreview() directly now - it's the one place that
// decides whether the target SQL's estimated bind parameters can be
// collected immediately (none detected) or need a user-confirmed value
// first (PerformanceTuningBindParametersPanel).
//
// Deliberately a separate file from performanceTuningPreview.ts, not a new
// export added to it: this file imports the new panel, which itself imports
// startPerformanceTuningPreview from performanceTuningPreview.ts - putting
// this function there instead would create a circular import between the
// two modules. startPerformanceTuningPreview() itself is completely
// unmodified by this change.
export type OpenPerformanceTuningPreviewParams = Omit<StartPerformanceTuningPreviewParams, "plan"> & {
  estimatedBindParameters: EstimatedBindParameter[];
  // Optional real values to pre-fill the confirm panel's rows with, parallel
  // to estimatedBindParameters by `position` (1-based, so index
  // `position - 1`) - e.g. Query History's last-executed variables. Ignored
  // when estimatedBindParameters is empty (nothing to pre-fill). A caller
  // with no such source (Query Statistics) simply omits this, and the panel
  // falls back to its normal blank fields.
  presetBindValues?: unknown[];
};

export type OpenPerformanceTuningPreviewResult = StartPerformanceTuningPreviewResult | { status: "deferred" };

export async function openPerformanceTuningPreview(
  params: OpenPerformanceTuningPreviewParams
): Promise<OpenPerformanceTuningPreviewResult> {
  const { estimatedBindParameters, presetBindValues, ...rest } = params;

  if (estimatedBindParameters.length === 0) {
    return startPerformanceTuningPreview({ ...rest, plan: {} });
  }

  PerformanceTuningBindParametersPanel.render(rest.extensionUri, {
    ...rest,
    estimatedBindParameters,
    presetBindValues,
  });
  // The actual collection now happens later, from inside the new panel,
  // once the user submits values - there is nothing more for this call's
  // caller to await.
  return { status: "deferred" };
}

// DynamoDB counterpart (design doc §7.4, and Decision 1 of the design
// review: "v1では未解決の`?`マーカーを含む文はRun Observed Readの対象外とす
// る。専用の値入力UIは作らない。"). v1 has no DynamoDB Bind Parameters Panel
// at all - a PartiQL statement with an unresolved `?` marker is simply
// excluded from Run Observed Read later (statement.observationEligibility,
// computed driver-side from the statement text alone - see
// DynamoDbPerformanceTuningProvider.ts's containsUnresolvedBindMarker()),
// never gated behind a value-input step here. The static Preview itself
// never needs bind values in the first place (it never reads item data), so
// this is always an immediate pass-through to
// startDynamoDbPerformanceTuningPreview() - kept as its own function (not
// folded into openPerformanceTuningPreview() above) since the two engines'
// params share no useful common shape (no estimatedBindParameters/
// presetBindValues concept exists for DynamoDB at all), while still living
// in this file per the design doc's file placement for the AWS branch.
export async function openDynamoDbPerformanceTuningPreview(
  params: StartDynamoDbPerformanceTuningPreviewParams
): Promise<StartDynamoDbPerformanceTuningPreviewResult> {
  return startDynamoDbPerformanceTuningPreview(params);
}
