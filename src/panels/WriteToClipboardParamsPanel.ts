import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { ActionCommand, WriteToClipboardParams } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { rdhListToText } from "../utilities/rdhToText";
import { WriteToClipboardParamsPanelEventData } from "../shared/MessageEventData";
import { ComponentName } from "../shared/ComponentName";

const PREFIX = "[WriteToClipboardParamsPanel]";

const componentName: ComponentName = "WriteToClipboardParamsPanel";

export class WriteToClipboardParamsPanel {
  public static currentPanel: WriteToClipboardParamsPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private list: ResultSetData[] = [];
  private params: WriteToClipboardParams | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(
      this._panel.webview,
      extensionUri,
      componentName
    );
    this._setWebviewMessageListener(this._panel.webview);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    WriteToClipboardParamsPanel.currentPanel = new WriteToClipboardParamsPanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, list: ResultSetData[], params: WriteToClipboardParams) {
    log(`${PREFIX} render`);
    if (WriteToClipboardParamsPanel.currentPanel) {
      WriteToClipboardParamsPanel.currentPanel._panel.reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "WriteToClipboardParams",
        "WriteToClipboardParams",
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
      WriteToClipboardParamsPanel.currentPanel = new WriteToClipboardParamsPanel(
        panel,
        extensionUri
      );
    }
    WriteToClipboardParamsPanel.currentPanel.list = list;
    WriteToClipboardParamsPanel.currentPanel.params = params;
    WriteToClipboardParamsPanel.currentPanel.renderSub();
  }

  async renderSub() {
    if (!this.params) {
      return;
    }
    const msg: WriteToClipboardParamsPanelEventData = {
      command: "initialize",
      componentName: "WriteToClipboardParamsPanel",
      value: {
        initialize: {
          params: this.params,
          previewText: rdhListToText(this.list, {
            ...this.params!,
            limit: Math.min(this.params?.limit ?? 10, 10),
          }),
        },
      },
    };

    this._panel.webview.postMessage(msg);
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    log(`${PREFIX} dispose`);

    WriteToClipboardParamsPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      async (message: ActionCommand) => {
        const { command, params } = message;
        switch (command) {
          case "writeToClipboard":
            if (params.specifyDetail === true) {
              this.params = params;
              this.renderSub();
            } else {
              await vscode.env.clipboard.writeText(rdhListToText(this.list, params));
              this.dispose();
            }
            return;
          case "cancel":
            this.dispose();
            return;
        }
      },
      undefined,
      this._disposables
    );
  }
}
