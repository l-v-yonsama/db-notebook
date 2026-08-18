import {
  ConnectionSetting,
  PerformanceTuningContext,
  RDSBaseDriver,
  SelectedStatementStatistics,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ProgressLocation, Uri, window } from "vscode";
import { PerformanceTuningPreviewPanel } from "../panels/PerformanceTuningPreviewPanel";
import { validatePlanBindsInput } from "../shared/PerformanceTuningBinds";
import { createRDSDriver, workflow } from "./driverResolver";

export type StartPerformanceTuningPreviewParams = {
  extensionUri: Uri;
  connectionSetting: ConnectionSetting;
  databaseName: string;
  statement: {
    sql: string;
    source: "statementStatistics" | "sqlHistory" | "editor";
    statistics?: SelectedStatementStatistics;
  };
  plan: {
    mode: "estimate";
    binds?: unknown[];
    // SQL Server-only today (named parameter substitution in SHOWPLAN - see
    // db-drivers' PerformanceTuningContext.ts). Same non-persistence rule as
    // `binds` itself: call-scoped only, never stored/logged/echoed back.
    bindMarkers?: string[];
  };
  // Explicit fallback for tables the vendor plan itself couldn't resolve -
  // sanctioned specifically for MySQL's EXPLAIN FORMAT=JSON reporting an
  // aliased table's *alias* (not its real name) as `table_name` (§6.5/§7.7
  // of performance-tuning-query-statistics-parameter-input-plan.ja.md).
  // Additive only: RDSBaseDriver.getPerformanceTuningContext() unions this
  // in alongside whatever the plan resolved, never replaces it.
  targetTables?: Array<{ schemaName?: string; tableName: string }>;
  // Corrects a plan-resolved table name that's actually an alias (same
  // MySQL EXPLAIN gap as targetTables above, but this *replaces* the
  // wrong name instead of adding a second entry - §6.6/§7.7). Keyed by the
  // lowercased alias (or bare table name for an unaliased reference).
  tableAliasMap?: Record<string, { schemaName?: string; tableName: string }>;
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

// Extracted from the 9a SQL-History handler so History and Query Statistics
// (9b) never duplicate static-support checks, progress UI, AbortController
// wiring, or getPerformanceTuningContext() error handling
// (misc/design/performance-tuning-context-implementation-plan.ja.md §10 Phase 5
// "Preview接続の共通化と競合防止"). Both callers get the same
// {status, message, technicalMessage} back and decide independently how to
// surface it - History as a notification, Query Statistics inline via its
// own previewStatus/previewMessage/previewTechnicalMessage.
export async function startPerformanceTuningPreview(
  params: StartPerformanceTuningPreviewParams
): Promise<StartPerformanceTuningPreviewResult> {
  const { extensionUri, connectionSetting, databaseName, statement, plan, targetTables, tableAliasMap } =
    params;

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

      return workflow<RDSBaseDriver, PerformanceTuningContext>(
        connectionSetting,
        (driver) =>
          driver
            .getPerformanceTuningContext(
              { databaseName, statement, plan, targetTables, tableAliasMap },
              { signal: controller.signal }
            )
            .then((r) => {
              if (!r.ok || !r.result) {
                throw new Error(r.message);
              }
              return r.result;
            }),
        true
      );
    }
  );

  if (ok && result) {
    PerformanceTuningPreviewPanel.render(extensionUri, result);
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
