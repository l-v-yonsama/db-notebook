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

// Shared preview entry point that requests representative bind values when needed.
// Kept separate from performanceTuningPreview.ts to avoid a circular panel import.
export type OpenPerformanceTuningPreviewParams = Omit<StartPerformanceTuningPreviewParams, "plan"> & {
  estimatedBindParameters: EstimatedBindParameter[];
  // Optional values to pre-fill rows, matched to estimates by 1-based position.
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
  // Collection resumes when the user submits the panel.
  return { status: "deferred" };
}

// DynamoDB previews need no bind-value panel because static collection does not read items.
// Statements with unresolved markers are excluded from Run Observed Read by the driver.
export async function openDynamoDbPerformanceTuningPreview(
  params: StartDynamoDbPerformanceTuningPreviewParams
): Promise<StartDynamoDbPerformanceTuningPreviewResult> {
  return startDynamoDbPerformanceTuningPreview(params);
}
