import { WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { ActionCommand, WriteToClipboardParams } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { rdhListToText } from "../utilities/rdhToText";
import { WriteToClipboardParamsPanelEventData } from "../shared/MessageEventData";
import { ComponentName } from "../shared/ComponentName";
import { BasePanel } from "./BasePanel";

const PREFIX = "[WriteToClipboardParamsPanel]";

export class WriteToClipboardParamsPanel extends BasePanel {
  public static currentPanel: WriteToClipboardParamsPanel | undefined;
  private list: ResultSetData[] = [];
  private params: WriteToClipboardParams | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    WriteToClipboardParamsPanel.currentPanel = new WriteToClipboardParamsPanel(panel, extensionUri);
  }

  getComponentName(): ComponentName {
    return "WriteToClipboardParamsPanel";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
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
  }

  protected preDispose(): void {
    WriteToClipboardParamsPanel.currentPanel = undefined;
  }

  public static render(extensionUri: Uri, list: ResultSetData[], params: WriteToClipboardParams) {
    if (WriteToClipboardParamsPanel.currentPanel) {
      WriteToClipboardParamsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
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

    this.panel.webview.postMessage(msg);
  }
}
