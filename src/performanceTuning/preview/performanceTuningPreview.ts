import {
  ConnectionSetting,
  PerformanceTuningCapabilities,
  PerformanceTuningContext,
  RDSBaseDriver,
  SelectedStatementStatistics,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ProgressLocation, Uri, window } from "vscode";
import { PerformanceTuningPreviewPanel } from "../../panels/PerformanceTuningPreviewPanel";
import type { AiMaskingLevel } from "../../shared/AiDataMasking";
import { validatePlanBindsInput } from "../../shared/PerformanceTuningBinds";
import { createRDSDriver, workflow } from "../../utilities/driverResolver";

// Request state retained by the host panel so it can rerun the same statement
// in analyze mode without trusting the webview to resend it.
export type PerformanceTuningPreviewRequest = {
  connectionSetting: ConnectionSetting;
  /** Connection-scoped default; the Preview may override it for this invocation only. */
  initialMaskingLevel: AiMaskingLevel;
  databaseName: string;
  statement: {
    sql: string;
    // `sqlHistory` is the driver contract's existing source value.
    source: "statementStatistics" | "sqlHistory" | "editor";
    statistics?: SelectedStatementStatistics;
  };
  plan: {
    binds?: unknown[];
    // Named placeholders required by SQL Server plan substitution. Like binds,
    // they are call-scoped and never persisted or logged.
    bindMarkers?: string[];
  };
  // Additive fallback for tables that the vendor plan cannot resolve.
  targetTables?: Array<{ schemaName?: string; tableName: string }>;
  // Corrects a plan-resolved alias to its real table name.
  tableAliasMap?: Record<string, { schemaName?: string; tableName: string }>;
};

export type StartPerformanceTuningPreviewParams = PerformanceTuningPreviewRequest & {
  extensionUri: Uri;
};

export type StartPerformanceTuningPreviewResult = {
  status: "opened" | "cancelled" | "failed";
  // Beginner-facing; never contains a raw DB exception, stack, or bind value.
  message?: string;
  // Optional non-secret detail shown separately from the user-facing message.
  technicalMessage?: string;
};

// Shared by Query History and Query Statistics so capability checks, progress,
// cancellation, and error handling stay consistent.
export async function startPerformanceTuningPreview(
  params: StartPerformanceTuningPreviewParams
): Promise<StartPerformanceTuningPreviewResult> {
  const { extensionUri, ...request } = params;
  const { connectionSetting, databaseName, statement, plan, targetTables, tableAliasMap } = request;

  // Validate binds at the shared entry point.
  if (plan.binds !== undefined) {
    const validated = validatePlanBindsInput(plan.binds);
    if (!validated.ok) {
      return { status: "failed", message: validated.message };
    }
  }

  const driverForSupportCheck = await createRDSDriver<RDSBaseDriver>(connectionSetting, true);
  if (!driverForSupportCheck.supportsGetPerformanceTuningContext()) {
    return {
      status: "failed",
      message: `Performance tuning is not supported for ${connectionSetting.dbType}.`,
    };
  }

  let cancelled = false;

  const { ok, message, result } = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      cancellable: true,
      title: "Collecting performance tuning context...",
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => {
        cancelled = true;
        controller.abort();
      });

      return workflow<RDSBaseDriver, { context: PerformanceTuningContext; capabilities: PerformanceTuningCapabilities }>(
        connectionSetting,
        async (driver) => {
          const [contextResult, capabilitiesResult] = await Promise.all([
            driver.getPerformanceTuningContext(
              { databaseName, statement, plan: { ...plan, mode: "estimate" }, targetTables, tableAliasMap },
              { signal: controller.signal }
            ),
            // Load static capabilities with the context so the preview can configure its actions.
            driver.checkPerformanceTuningContextAvailability(
              { databaseName },
              { signal: controller.signal }
            ),
          ]);
          if (!contextResult.ok || !contextResult.result) {
            throw new Error(contextResult.message);
          }
          // A capability lookup failure disables affected actions without blocking the preview.
          const capabilities: PerformanceTuningCapabilities = capabilitiesResult.ok && capabilitiesResult.result
            ? capabilitiesResult.result
            : {
                executionPlan: { available: false },
                analyzedExecutionPlan: { available: false, message: capabilitiesResult.message },
                tableDefinition: { available: false },
                optimizerStatistics: { available: false },
                physicalHealth: { available: false },
              };
          return { context: contextResult.result, capabilities };
        },
        true
      );
    }
  );

  if (ok && result) {
    PerformanceTuningPreviewPanel.render(extensionUri, result.context, request, result.capabilities.analyzedExecutionPlan);
    return { status: "opened" };
  }

  if (cancelled) {
    return { status: "cancelled" };
  }

  return {
    status: "failed",
    message:
      "Failed to collect performance tuning context. If this statement uses placeholders, it may need representative bind values.",
    technicalMessage: message,
  };
}
