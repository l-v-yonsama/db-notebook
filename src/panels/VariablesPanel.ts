import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { ComponentName } from "../shared/ComponentName";
import { VariablesPanelEventData } from "../shared/MessageEventData";

const PREFIX = "[VariablesPanel]";

const componentName: ComponentName = "VariablesPanel";

export class VariablesPanel {
  public static currentPanel: VariablesPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private variables: ResultSetData | undefined;

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
    VariablesPanel.currentPanel = new VariablesPanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, variables: { [key: string]: any }) {
    log(`${PREFIX} render`);
    if (VariablesPanel.currentPanel) {
      VariablesPanel.currentPanel._panel.reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel("VariablesType", "Variables", ViewColumn.Two, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          Uri.joinPath(extensionUri, "out"),
          Uri.joinPath(extensionUri, "webview-ui/build"),
        ],
      });
      VariablesPanel.currentPanel = new VariablesPanel(panel, extensionUri);
    }
    VariablesPanel.currentPanel.variables = ResultSetDataBuilder.from(variables).build();
    VariablesPanel.currentPanel.renderSub();
  }

  async renderSub() {
    if (!this.variables) {
      return;
    }
    const msg: VariablesPanelEventData = {
      command: "initialize",
      componentName: "VariablesPanel",
      value: {
        initialize: {
          variables: this.variables,
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

    VariablesPanel.currentPanel = undefined;
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
        // log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
        // switch (command) {
        //   case "refresh":
        //     this.refresh(params);
        //     return;
      },
      undefined,
      this._disposables
    );
  }
}
