import { EstimatedBindParameter } from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { ActionCommand, SubmitPerformanceTuningBindParametersActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { PerformanceTuningBindParametersPanelEventData } from "../shared/MessageEventData";
import { validatePlanBindsInput } from "../shared/PerformanceTuningBinds";
import { createCodeHtmlString } from "../utilities/highlighter";
import {
  StartPerformanceTuningPreviewParams,
  startPerformanceTuningPreview,
} from "../utilities/performanceTuningPreview";
import { BasePanel } from "./BasePanel";

// Query Statistics (ToolsView.vue) had a working
// Bind Parameters UI, but Query History (HistoryTreeCommand.ts) had none at
// all - a parameterized History entry silently failed to collect a plan.
// Rather than build a second, duplicate bind-input UI for History, or fold
// bind collection into PerformanceTuningPreviewPanel itself (which would
// require that panel to grow a "not collected yet" phase it doesn't have
// today), this is a small, dedicated, entry-point-agnostic panel - same
// family as ViewConditionPanel.vue - that both entry points open via
// openPerformanceTuningPreview()
// (src/utilities/performanceTuningBindConfirmation.ts) whenever the target
// SQL has detected placeholders. PerformanceTuningPreviewPanel itself is
// completely unmodified by this change.
export type PerformanceTuningBindParametersPanelParams = Omit<StartPerformanceTuningPreviewParams, "plan"> & {
  estimatedBindParameters: EstimatedBindParameter[];
  // Real values to pre-fill the row table with (parallel to
  // estimatedBindParameters by `position`), when the caller has them - see
  // openPerformanceTuningPreview()'s own doc comment. Undefined for Query
  // Statistics (no such source); Query History passes its last-executed
  // history.variables, converted to positional order.
  presetBindValues?: unknown[];
};

export class PerformanceTuningBindParametersPanel extends BasePanel {
  public static currentPanel: PerformanceTuningBindParametersPanel | undefined;

  // Held so the eventual "Preview" click can call startPerformanceTuningPreview()
  // with everything except plan.binds/bindMarkers, which only the user's
  // submitted rows can supply.
  private params: PerformanceTuningBindParametersPanelParams | undefined;
  private submitting = false;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    PerformanceTuningBindParametersPanel.currentPanel = new PerformanceTuningBindParametersPanel(
      panel,
      extensionUri
    );
  }

  public static render(extensionUri: Uri, params: PerformanceTuningBindParametersPanelParams) {
    if (PerformanceTuningBindParametersPanel.currentPanel) {
      PerformanceTuningBindParametersPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel(
        "PerformanceTuningBindParametersPanelType",
        "Bind Parameters",
        ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      PerformanceTuningBindParametersPanel.currentPanel = new PerformanceTuningBindParametersPanel(
        panel,
        extensionUri
      );
    }
    PerformanceTuningBindParametersPanel.currentPanel.renderSub(params);
  }

  getComponentName(): ComponentName {
    return "PerformanceTuningBindParametersPanel";
  }

  private async renderSub(params: PerformanceTuningBindParametersPanelParams): Promise<void> {
    this.params = params;
    this.submitting = false;

    const sqlHtml = await createCodeHtmlString({ code: params.statement.sql, lang: "sql" });

    const msg: PerformanceTuningBindParametersPanelEventData = {
      command: "initialize",
      componentName: "PerformanceTuningBindParametersPanel",
      value: {
        initialize: {
          sqlHtml,
          dbType: params.connectionSetting.dbType,
          estimatedBindParameters: params.estimatedBindParameters,
          presetBindValues: params.presetBindValues,
        },
      },
    };
    this.getWebviewPanel().webview.postMessage(msg);
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    switch (message.command) {
      case "cancel":
        this.dispose();
        break;
      case "submitPerformanceTuningBindParameters":
        await this.submit(message.params);
        break;
    }
  }

  // Same validation/marker-pairing rules ToolsViewProvider.previewPerformanceTuning()
  // used to run itself (moved here, not duplicated - that method now calls
  // openPerformanceTuningPreview() before any bind values exist to validate).
  private async submit(
    params: SubmitPerformanceTuningBindParametersActionCommand["params"]
  ): Promise<void> {
    if (!this.params || this.submitting) {
      return;
    }

    const validated = validatePlanBindsInput(params.values);
    if (!validated.ok) {
      await this.postCollectionResult({ status: "failed", message: validated.message });
      return;
    }
    const markers = Array.isArray(params.markers)
      ? params.markers.filter((m): m is string => typeof m === "string")
      : [];
    const bindMarkers =
      markers.length === validated.binds.length && markers.length > 0 ? markers : undefined;

    this.submitting = true;
    const result = await startPerformanceTuningPreview({
      ...this.params,
      plan: {
        binds: validated.binds.length > 0 ? validated.binds : undefined,
        bindMarkers,
      },
    });
    this.submitting = false;

    if (result.status === "opened") {
      // PerformanceTuningPreviewPanel is already showing the result - this
      // panel's job is done.
      this.dispose();
      return;
    }
    // Rebuilt field-by-field (not `result` as-is): TS narrows a direct
    // `result.status` read here to "cancelled" | "failed", but not the type
    // of `result` itself - StartPerformanceTuningPreviewResult is one object
    // type with a union-typed field, not a discriminated union of object
    // types, so it isn't narrowed as a whole value.
    await this.postCollectionResult({
      status: result.status,
      message: result.message,
      technicalMessage: result.technicalMessage,
    });
  }

  private async postCollectionResult(result: {
    status: "cancelled" | "failed";
    message?: string;
    technicalMessage?: string;
  }): Promise<void> {
    const msg: PerformanceTuningBindParametersPanelEventData = {
      command: "collection-result",
      componentName: "PerformanceTuningBindParametersPanel",
      value: { collectionResult: result },
    };
    await this.getWebviewPanel().webview.postMessage(msg);
  }

  protected preDispose(): void {
    PerformanceTuningBindParametersPanel.currentPanel = undefined;
  }
}
