import {
  ConnectionSetting,
  PerformanceTuningCapabilities,
  PerformanceTuningContext,
  RDSBaseDriver,
  SelectedStatementStatistics,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ProgressLocation, Uri, window } from "vscode";
import { PerformanceTuningPreviewPanel } from "../panels/PerformanceTuningPreviewPanel";
import { validatePlanBindsInput } from "../shared/PerformanceTuningBinds";
import { createRDSDriver, workflow } from "./driverResolver";

// Request state retained by the host panel so it can rerun the same statement
// in analyze mode without trusting the webview to resend it.
export type PerformanceTuningPreviewRequest = {
  connectionSetting: ConnectionSetting;
  databaseName: string;
  statement: {
    sql: string;
    // "sqlHistory" is db-drivers' own PerformanceTuningContext union value,
    // not this extension's naming - it stays as-is even though the view is
    // now called Query History, so the two contracts keep lining up.
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
  // The same boundary getPerformanceTuningContext() itself already promises
  // for GeneralResult.message (fixed text or a driver-classified, non-secret
  // detail) - shown as an optional, collapsible "technical details", never
  // substituted for `message` (§10 Phase 5 "Preview接続の共通化と競合防止").
  technicalMessage?: string;
};

// Shared by Query History and Query Statistics so capability checks, progress,
// cancellation, and error handling stay consistent.
export async function startPerformanceTuningPreview(
  params: StartPerformanceTuningPreviewParams
): Promise<StartPerformanceTuningPreviewResult> {
  const { extensionUri, ...request } = params;
  const { connectionSetting, databaseName, statement, plan, targetTables, tableAliasMap } = request;

  // Defense in depth: the webview and ToolsViewProvider already validate
  // Query Statistics' representative bind values before reaching here, and
  // History never passes any - but this is the one place both paths funnel
  // through, so it's also the one place that can guarantee the invariant
  // regardless of which caller (mis)behaves.
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
            // "Run EXPLAIN ANALYZE" (2026-08-20 follow-up) needs to know up
            // front whether this Provider can do it at all, to enable/
            // disable+tooltip the button - this is a static per-Provider
            // capability report (no EXPLAIN, no catalog query - see
            // checkCapabilities()'s own doc comment in db-drivers), so
            // fetching it alongside the real collection costs nothing extra
            // worth gating behind a second round trip.
            driver.checkPerformanceTuningContextAvailability(
              { databaseName },
              { signal: controller.signal }
            ),
          ]);
          if (!contextResult.ok || !contextResult.result) {
            throw new Error(contextResult.message);
          }
          // A capabilities failure is not fatal to opening the preview - it
          // just means the button falls back to "not available" (disabled)
          // rather than blocking the whole panel on a secondary check.
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
