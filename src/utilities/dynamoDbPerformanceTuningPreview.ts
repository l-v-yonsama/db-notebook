import {
  AwsDriver,
  ConnectionSetting,
  DynamoDbPerformanceTuningCapabilities,
  DynamoDbPerformanceTuningContext,
  DynamoDbWorkloadContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ProgressLocation, Uri, window } from "vscode";
import { PerformanceTuningPreviewPanel } from "../panels/PerformanceTuningPreviewPanel";
import { createSQLSupportDriver, workflow } from "./driverResolver";

// DynamoDB counterpart of performanceTuningPreview.ts's
// startPerformanceTuningPreview(). Request state retained by the host panel
// so it can rerun the same statement in "Run Observed Read" mode without
// trusting the webview to resend it - same rationale as
// PerformanceTuningPreviewRequest.
export type DynamoDbPerformanceTuningPreviewRequest = {
  connectionSetting: ConnectionSetting;
  statement: {
    source: "sqlHistory" | "editor" | "dynamoQueryPanel";
    // v1 only wires up the PartiQL entry points (SQL History, an executed
    // Notebook cell) - see HistoryTreeCommand.ts's AWS branch and
    // activator.ts. A native Query request (Dynamo Query Panel's own
    // "Preview Performance" button, design doc §11.3) needs a values-free
    // DynamoDbQueryAnalysisInput for the static context plus the *real*
    // AWS-SDK QueryCommandInput (with ExpressionAttributeValues) for Run
    // Observed Read - db-notebook has no direct @aws-sdk/client-dynamodb
    // dependency today (it always goes through db-drivers' own types), so
    // that wiring is deliberately left for the Dynamo Query Panel
    // integration step rather than guessed at here.
    request: { kind: "partiql"; text: string };
  };
  // SQL History's rolling Capacity/timing aggregate for this exact statement
  // (sqlHistoryUtil.ts's mergeSQLHistoryPerformance/averageCapacityUnits) -
  // optional, since an editor/Notebook-cell-originated preview has no prior
  // history to aggregate.
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

// Shared by SQL History and (once wired) the executed-Notebook-cell/Dynamo
// Query Panel entry points, mirroring startPerformanceTuningPreview()'s own
// role for RDB.
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
          const contextResult = await driver.getDynamoDbPerformanceTuningContext(
            { statement: { source: statement.source, request: statement.request, workload } },
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
