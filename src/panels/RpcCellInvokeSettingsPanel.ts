import { parseRpcRequestMetadata } from "@l-v-yonsama/multi-platform-database-drivers";
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
import { RpcCellService } from "../notebook/RpcCellService";
import { getRpcCellMetadata, isRpcCell } from "../notebook/rpcCell";
import type { RpcCellInvokeSettingsPanelEventData } from "../shared/MessageEventData";
import { createWebviewContent } from "../utilities/webview/webviewUtil";

type PanelCommand = {
  command: "ready" | "cancel" | "saveRpcCellMetadata" | "reloadDescriptor" | "insertRpcTemplate";
  params?: { metadataJson?: string };
};

/** Settings belong to the cell, so they remain visible when outputs are cleared. */
export class RpcCellInvokeSettingsPanel {
  private static current: RpcCellInvokeSettingsPanel | undefined;
  private readonly disposables: Disposable[] = [];
  private cell: NotebookCell | undefined;
  private ready = false;
  private generation = 0;

  private constructor(
    private readonly panel: WebviewPanel,
    extensionUri: Uri,
    private readonly rpcCellService: RpcCellService
  ) {
    panel.webview.html = createWebviewContent(
      panel.webview,
      extensionUri,
      "RpcCellInvokeSettingsPanel"
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    panel.webview.onDidReceiveMessage(
      (message: PanelCommand) => void this.onMessage(message),
      undefined,
      this.disposables
    );
  }

  static render(extensionUri: Uri, cell: NotebookCell, rpcCellService: RpcCellService): void {
    if (!isRpcCell(cell)) {
      return;
    }
    if (!this.current) {
      const panel = window.createWebviewPanel(
        "RpcCellInvokeSettingsPanel",
        "RPC Cell Invoke Settings",
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
      this.current = new RpcCellInvokeSettingsPanel(panel, extensionUri, rpcCellService);
    } else {
      this.current.panel.reveal(ViewColumn.Two);
    }
    this.current.cell = cell;
    this.current.generation++;
    if (this.current.ready) {
      void this.current.initialize();
    }
  }

  private post(
    command: RpcCellInvokeSettingsPanelEventData["command"],
    value: RpcCellInvokeSettingsPanelEventData["value"]
  ): void {
    void this.panel.webview.postMessage({
      command,
      componentName: "RpcCellInvokeSettingsPanel",
      value,
    } satisfies RpcCellInvokeSettingsPanelEventData);
  }

  private async initialize(): Promise<void> {
    const cell = this.cell;
    if (!cell) {
      return;
    }
    const metadata = getRpcCellMetadata(cell);
    this.post("initialize", {
      connectionName: metadata.connectionName,
      method:
        metadata.rpc.service && metadata.rpc.method
          ? `${metadata.rpc.service}/${metadata.rpc.method}`
          : undefined,
      metadataJson: metadata.rpc.metadataJson ?? "{}",
    });
    await this.showDescriptor(false);
  }

  private async showDescriptor(reload: boolean): Promise<void> {
    const cell = this.cell;
    const generation = this.generation;
    if (!cell) {
      return;
    }
    try {
      const descriptor = await this.rpcCellService.getDescriptor(cell, reload);
      if (generation === this.generation) {
        this.post("descriptor", { descriptor });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.post("error", { error: String(error) });
      }
    }
  }

  private async onMessage(message: PanelCommand): Promise<void> {
    if (message.command === "ready") {
      this.ready = true;
      await this.initialize();
      return;
    }
    if (message.command === "cancel") {
      this.panel.dispose();
      return;
    }
    const cell = this.cell;
    if (!cell || !isRpcCell(cell)) {
      return;
    }
    if (message.command === "reloadDescriptor") {
      await this.showDescriptor(true);
      return;
    }
    if (message.command === "insertRpcTemplate") {
      try {
        await this.rpcCellService.insertTemplate(cell);
      } catch (error) {
        this.post("error", { error: String(error) });
      }
      return;
    }
    if (
      message.command !== "saveRpcCellMetadata" ||
      typeof message.params?.metadataJson !== "string"
    ) {
      return;
    }
    try {
      const metadataJson = message.params.metadataJson;
      const parsed: unknown = metadataJson.trim() ? JSON.parse(metadataJson) : {};
      parseRpcRequestMetadata(parsed);
      const metadata = getRpcCellMetadata(cell);
      const edit = new WorkspaceEdit();
      edit.set(cell.notebook.uri, [
        NotebookEdit.updateCellMetadata(cell.index, {
          ...metadata,
          rpc: { ...metadata.rpc, metadataJson },
        }),
      ]);
      if (!(await workspace.applyEdit(edit))) {
        throw new Error("Could not save RPC metadata.");
      }
      this.panel.dispose();
    } catch (error) {
      this.post("error", { error: String(error) });
    }
  }

  private dispose(): void {
    if (RpcCellInvokeSettingsPanel.current === this) {
      RpcCellInvokeSettingsPanel.current = undefined;
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}
