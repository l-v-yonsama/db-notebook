import {
  Disposable,
  NotebookCell,
  NotebookEdit,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { getRestCellMetadata, isRestCell } from "../notebook/restCell";
import { parseRestHeaders } from "../notebook/restVariables";
import type { RestCellRequestSettingsPanelEventData } from "../shared/MessageEventData";
import { createWebviewContent } from "../utilities/webview/webviewUtil";

type PanelCommand = {
  command: "ready" | "cancel" | "saveRestCellSettings";
  params?: { headersJson?: string; timeoutMs?: number };
};

export class RestCellRequestSettingsPanel {
  private static current: RestCellRequestSettingsPanel | undefined;
  private readonly disposables: Disposable[] = [];
  private cell: NotebookCell | undefined;
  private ready = false;

  private constructor(private readonly panel: WebviewPanel, extensionUri: Uri) {
    panel.webview.html = createWebviewContent(
      panel.webview,
      extensionUri,
      "RestCellRequestSettingsPanel"
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    panel.webview.onDidReceiveMessage(
      (message: PanelCommand) => void this.onMessage(message),
      undefined,
      this.disposables
    );
  }

  static render(extensionUri: Uri, cell: NotebookCell): void {
    if (!isRestCell(cell)) {
      return;
    }
    if (!this.current) {
      const panel = window.createWebviewPanel(
        "RestCellRequestSettingsPanel",
        "REST JSON Request Settings",
        ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      this.current = new RestCellRequestSettingsPanel(panel, extensionUri);
    } else {
      this.current.panel.reveal(ViewColumn.Two);
    }
    this.current.cell = cell;
    if (this.current.ready) {
      this.current.initialize();
    }
  }

  private post(
    command: RestCellRequestSettingsPanelEventData["command"],
    value: RestCellRequestSettingsPanelEventData["value"]
  ): void {
    void this.panel.webview.postMessage({
      command,
      componentName: "RestCellRequestSettingsPanel",
      value,
    } satisfies RestCellRequestSettingsPanelEventData);
  }

  private initialize(): void {
    if (!this.cell) {
      return;
    }
    const rest = getRestCellMetadata(this.cell).rest;
    this.post("initialize", {
      method: rest.method,
      url: rest.url,
      headersJson: rest.headersJson,
      timeoutMs: rest.timeoutMs,
    });
  }

  private async onMessage(message: PanelCommand): Promise<void> {
    if (message.command === "ready") {
      this.ready = true;
      this.initialize();
      return;
    }
    if (message.command === "cancel") {
      this.panel.dispose();
      return;
    }
    const cell = this.cell;
    if (message.command !== "saveRestCellSettings" || !cell || !isRestCell(cell)) {
      return;
    }
    try {
      const source = message.params?.headersJson?.trim() || "{}";
      parseRestHeaders(source);
      const timeoutMs = message.params?.timeoutMs;
      if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
        throw new Error("Timeout must be a non-negative integer in milliseconds.");
      }
      const metadata = getRestCellMetadata(cell);
      const edit = new WorkspaceEdit();
      edit.set(cell.notebook.uri, [
        NotebookEdit.updateCellMetadata(cell.index, {
          ...metadata,
          rest: { ...metadata.rest, headersJson: source, timeoutMs },
        }),
      ]);
      if (!(await workspace.applyEdit(edit))) {
        throw new Error("Could not save REST settings.");
      }
      this.panel.dispose();
    } catch (error) {
      this.post("error", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private dispose(): void {
    if (RestCellRequestSettingsPanel.current === this) {
      RestCellRequestSettingsPanel.current = undefined;
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}
