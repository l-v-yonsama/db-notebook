import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  PerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { PerformanceTuningPreviewPanelEventData } from "../shared/MessageEventData";
import { createCodeHtmlString } from "../utilities/highlighter";
import { buildPerformanceTuningDiagnosticGroups } from "../utilities/performanceTuningDiagnosticFormatter";
import { BasePanel } from "./BasePanel";

// Read-only "what would be sent" preview for getPerformanceTuningContext()'s
// result (推奨着手順 step 9a; diagnostic display per
// misc/design/performance-tuning-context-implementation-plan.ja.md §4.4/§10 Phase 5). No
// literal masking (matches the design's §9.2 policy) and no "send" action -
// AI submission is step 10, not built yet, so this panel only lets the user
// review the SQL, payload size, collection status/diagnostics and the raw
// JSON before that exists. Diagnostic grouping/copy is computed once here
// (buildPerformanceTuningDiagnosticGroups()) rather than in the Vue
// component, so it stays unit-testable with the rest of this extension's
// vitest suite instead of needing a separate webview-ui test setup.
export class PerformanceTuningPreviewPanel extends BasePanel {
  public static currentPanel: PerformanceTuningPreviewPanel | undefined;

  // The singleton panel can be re-render()ed with a new context before a
  // prior renderSub() call's async syntax highlighting finishes (e.g. Query
  // Statistics' 9b lets a user trigger back-to-back previews from different
  // rows). Guards against the slower, older call posting its result after
  // the newer one already has (§10 Phase 5 "PerformanceTuningPreviewPanel...
  // にもrenderGenerationを持たせる").
  private renderGeneration = 0;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    PerformanceTuningPreviewPanel.currentPanel = new PerformanceTuningPreviewPanel(
      panel,
      extensionUri
    );
  }

  public static render(extensionUri: Uri, context: PerformanceTuningContext) {
    if (PerformanceTuningPreviewPanel.currentPanel) {
      PerformanceTuningPreviewPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel(
        "PerformanceTuningPreviewPanelType",
        "Performance Tuning Preview",
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
      PerformanceTuningPreviewPanel.currentPanel = new PerformanceTuningPreviewPanel(
        panel,
        extensionUri
      );
    }
    PerformanceTuningPreviewPanel.currentPanel.renderSub(context);
  }

  getComponentName(): ComponentName {
    return "PerformanceTuningPreviewPanel";
  }

  private async renderSub(context: PerformanceTuningContext): Promise<void> {
    const myGeneration = ++this.renderGeneration;

    // Computed here (not in the webview) so the number shown always matches
    // what RDSBaseDriver.enforcePayloadBudget() itself measured the result
    // against.
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

    const [sqlHtml, jsonHtml] = await Promise.all([
      createCodeHtmlString({ code: context.statement.sql, lang: "sql" }),
      createCodeHtmlString({ code: contextJson, lang: "json" }),
    ]);

    if (myGeneration !== this.renderGeneration) {
      // A newer render() call started (and possibly already finished) while
      // this one was highlighting - never let the older result win.
      return;
    }

    const diagnosticGroups = buildPerformanceTuningDiagnosticGroups(
      context.collection.diagnostics,
      context.collection.unavailableSections
    );

    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "initialize",
      componentName: "PerformanceTuningPreviewPanel",
      value: {
        initialize: {
          context,
          diagnosticGroups,
          sqlHtml,
          jsonHtml,
          payloadBytes,
          maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
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
    }
  }

  protected preDispose(): void {
    PerformanceTuningPreviewPanel.currentPanel = undefined;
  }
}
