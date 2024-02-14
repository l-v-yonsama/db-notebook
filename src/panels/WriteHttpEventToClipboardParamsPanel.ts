import { WebviewPanel, window, Uri, ViewColumn } from "vscode";
import * as vscode from "vscode";
import { ActionCommand, WriteHttpEventToClipboardParams } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { WriteHttpEventToClipboardParamsPanelEventData } from "../shared/MessageEventData";
import { ComponentName } from "../shared/ComponentName";
import { BasePanel } from "./BasePanel";
import { NodeRunAxiosEvent } from "../shared/RunResultMetadata";
import { httpEventToText } from "../utilities/httpUtil";

const PREFIX = "[WriteJttpEventToClipboardParamsPanel]";

export class WriteHttpEventToClipboardParamsPanel extends BasePanel {
  public static currentPanel: WriteHttpEventToClipboardParamsPanel | undefined;
  private item: NodeRunAxiosEvent | undefined;
  private params: WriteHttpEventToClipboardParams | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    WriteHttpEventToClipboardParamsPanel.currentPanel = new WriteHttpEventToClipboardParamsPanel(
      panel,
      extensionUri
    );
  }

  getComponentName(): ComponentName {
    return "WriteHttpEventToClipboardParamsPanel";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "writeHttpEventToClipboard":
        if (params.specifyDetail === true) {
          this.params = params;
          this.renderSub();
        } else {
          this.writeToClipboard(params);
          this.dispose();
        }
        return;
      case "cancel":
        this.dispose();
        return;
    }
  }

  private async writeToClipboard(params: WriteHttpEventToClipboardParams) {
    if (!this.item) {
      return;
    }

    await vscode.env.clipboard.writeText(httpEventToText(this.item?.entry, params));
  }

  protected preDispose(): void {
    WriteHttpEventToClipboardParamsPanel.currentPanel = undefined;
  }

  public static render(
    extensionUri: Uri,
    item: NodeRunAxiosEvent,
    params: WriteHttpEventToClipboardParams
  ) {
    if (WriteHttpEventToClipboardParamsPanel.currentPanel) {
      WriteHttpEventToClipboardParamsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
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
      WriteHttpEventToClipboardParamsPanel.currentPanel = new WriteHttpEventToClipboardParamsPanel(
        panel,
        extensionUri
      );
    }
    WriteHttpEventToClipboardParamsPanel.currentPanel.item = item;
    WriteHttpEventToClipboardParamsPanel.currentPanel.params = params;
    WriteHttpEventToClipboardParamsPanel.currentPanel.renderSub();
  }

  async renderSub() {
    if (!this.params || !this.item) {
      return;
    }
    const msg: WriteHttpEventToClipboardParamsPanelEventData = {
      command: "initialize",
      componentName: "WriteHttpEventToClipboardParamsPanel",
      value: {
        initialize: {
          params: this.params,
          previewText: httpEventToText(this.item?.entry, this.params),
        },
      },
    };

    this.panel.webview.postMessage(msg);
  }
}
