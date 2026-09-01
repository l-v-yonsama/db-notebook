import {
  AwsDriver,
  ConnectionSetting,
  DynamoDbPerformanceTuningCapabilities,
  DynamoDbPerformanceTuningContext,
  DynamoDbReadObservation,
  DynamoDbWorkloadContext,
  QueryItemsAtClientInputParams,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ProgressLocation, Uri, window } from "vscode";
import { PerformanceTuningPreviewPanel } from "../../panels/PerformanceTuningPreviewPanel";
import type { AiMaskingLevel } from "../../shared/AiDataMasking";
import { createSQLSupportDriver, workflow } from "../../utilities/driverResolver";
import { toDynamoDbQueryAnalysisInput } from "./dynamoDbQueryAnalysisInput";

// Host-owned request state for static analysis and Run Observed Read.
export type DynamoDbPerformanceTuningPreviewRequest = {
  connectionSetting: ConnectionSetting;
  /** Connection-scoped default; the Preview may override it for this invocation only. */
  initialMaskingLevel: AiMaskingLevel;
  statement: {
    // Existing driver-contract source value.
    source: "sqlHistory" | "editor";
    request:
      | { kind: "partiql"; text: string }
      // Retain the native request only for this preview; it is never persisted or logged.
      | { kind: "query"; input: QueryItemsAtClientInputParams };
    // Optional values-free evidence from the most recent matching history entry.
    previousObservation?: DynamoDbReadObservation;
  };
  // Optional Capacity and timing aggregate from matching Query History entries.
  workload?: DynamoDbWorkloadContext;
};

export type StartDynamoDbPerformanceTuningPreviewParams = DynamoDbPerformanceTuningPreviewRequest & {
  extensionUri: Uri;
};

export type StartDynamoDbPerformanceTuningPreviewResult = {
  status: "opened" | "cancelled" | "failed";
  // Beginner-facing; never contains a raw AWS exception, stack, or item data.
  message?: string;
  technicalMessage?: string;
};

const UNAVAILABLE_DYNAMODB_CAPABILITIES: DynamoDbPerformanceTuningCapabilities = {
  staticAccessPattern: { available: false },
  tableDefinition: { available: false },
  cloudWatchMetrics: { available: false },
  contributorInsightsStatus: { available: false },
  observedRead: { available: false },
};

// Shared by Query History and executed notebook cells.
export async function startDynamoDbPerformanceTuningPreview(
  params: StartDynamoDbPerformanceTuningPreviewParams
): Promise<StartDynamoDbPerformanceTuningPreviewResult> {
  const { extensionUri, ...request } = params;
  const { connectionSetting, statement, workload } = request;

  const driverForSupportCheck = await createSQLSupportDriver<AwsDriver>(connectionSetting, true);
  if (!driverForSupportCheck.supportsGetDynamoDbPerformanceTuningContext()) {
    return {
      status: "failed",
      message: "DynamoDB performance tuning is not available for this connection.",
    };
  }

  let cancelled = false;

  const { ok, message, result } = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      cancellable: true,
      title: "Collecting DynamoDB performance tuning context...",
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => {
        cancelled = true;
        controller.abort();
      });

      return workflow<
        AwsDriver,
        { context: DynamoDbPerformanceTuningContext; capabilities: DynamoDbPerformanceTuningCapabilities }
      >(
        connectionSetting,
        async (driver) => {
          // The static collection path only ever receives the values-free
          // DynamoDbQueryAnalysisInput mirror for a native Query - never the
          // real QueryItemsAtClientInputParams this request itself carries
          // (which retains ExpressionAttributeValues, used only later, by
          // runObservedRead(), for the one call that genuinely needs them).
          const staticRequest =
            statement.request.kind === "partiql"
              ? statement.request
              : { kind: "query" as const, input: toDynamoDbQueryAnalysisInput(statement.request.input) };
          const contextResult = await driver.getDynamoDbPerformanceTuningContext(
            {
              statement: {
                source: statement.source,
                request: staticRequest,
                workload,
                previousObservation: statement.previousObservation,
              },
            },
            { signal: controller.signal }
          );
          if (!contextResult.ok || !contextResult.result) {
            throw new Error(contextResult.message);
          }
          // Cheap and static today (no AWS I/O - see checkCapabilities()'s
          // own doc comment in db-drivers), so this runs *after* the real
          // collection rather than in parallel with it: it needs the
          // table/index the statement actually resolved to, which for a
          // PartiQL statement is only known once collection has parsed the
          // FROM clause.
          const capabilitiesResult = await driver.checkDynamoDbPerformanceTuningContextAvailability(
            {
              tableName: contextResult.result.service.tableName,
              indexName: contextResult.result.service.indexName,
            },
            { signal: controller.signal }
          );
          const capabilities: DynamoDbPerformanceTuningCapabilities =
            capabilitiesResult.ok && capabilitiesResult.result
              ? capabilitiesResult.result
              : {
                  ...UNAVAILABLE_DYNAMODB_CAPABILITIES,
                  observedRead: { available: false, message: capabilitiesResult.message },
                };
          return { context: contextResult.result, capabilities };
        },
        true
      );
    }
  );

  if (ok && result) {
    PerformanceTuningPreviewPanel.renderDynamoDb(
      extensionUri,
      result.context,
      request,
      result.capabilities.observedRead
    );
    return { status: "opened" };
  }

  if (cancelled) {
    return { status: "cancelled" };
  }

  return {
    status: "failed",
    message: "Failed to collect DynamoDB performance tuning context.",
    technicalMessage: message,
  };
}
