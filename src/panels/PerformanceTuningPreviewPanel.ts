import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  PerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { PerformanceTuningPreviewPanelEventData } from "../shared/MessageEventData";
import { createCodeHtmlString } from "../utilities/highlighter";
import { BasePanel } from "./BasePanel";

// Read-only "what would be sent" preview for getPerformanceTuningContext()'s
// result (推奨着手順 step 9a). No literal masking (matches the design's
// §9.2 policy) and no "send" action - AI submission is step 10, not built
// yet, so this panel only lets the user review the SQL, payload size,
// collection status/warnings and the raw JSON before that exists.
export class PerformanceTuningPreviewPanel extends BasePanel {
  public static currentPanel: PerformanceTuningPreviewPanel | undefined;

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
    // Computed here (not in the webview) so the number shown always matches
    // what RDSBaseDriver.enforcePayloadBudget() itself measured the result
    // against.
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

    const [sqlHtml, jsonHtml] = await Promise.all([
      createCodeHtmlString({ code: context.statement.sql, lang: "sql" }),
      createCodeHtmlString({ code: contextJson, lang: "json" }),
    ]);

    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "initialize",
      componentName: "PerformanceTuningPreviewPanel",
      value: {
        initialize: {
          context,
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
