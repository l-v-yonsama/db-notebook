import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  NotebookCellData,
  NotebookCellKind,
  commands,
  env,
} from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import { ActionCommand, WriteToClipboardParams } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { ERDiagramSettingParams } from "../shared/ERDiagram";
import { createERDiagramParams, createErDiagram } from "../utilities/erDiagramGenerator";
import { CREATE_NEW_NOTEBOOK } from "../constant";
import { ComponentName } from "../shared/ComponentName";
import {
  ERDiagramSettingsInputParams,
  ERDiagramSettingsPanelEventData,
} from "../shared/MessageEventData";

const PREFIX = "[ERDiagramSettingsPanel]";

dayjs.extend(utc);

const componentName: ComponentName = "ERDiagramSettingsPanel";

export class ERDiagramSettingsPanel {
  public static currentPanel: ERDiagramSettingsPanel | undefined;
  private static stateStorage?: StateStorage;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private variables: ERDiagramSettingsInputParams | undefined;

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

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    ERDiagramSettingsPanel.currentPanel = new ERDiagramSettingsPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    ERDiagramSettingsPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, params: ERDiagramSettingsInputParams) {
    log(`${PREFIX} render`);
    if (ERDiagramSettingsPanel.currentPanel) {
      ERDiagramSettingsPanel.currentPanel._panel.reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "ERDiagramSettingsType",
        "ER Diagram Settings",
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
      ERDiagramSettingsPanel.currentPanel = new ERDiagramSettingsPanel(panel, extensionUri);
    }
    ERDiagramSettingsPanel.currentPanel.variables = params;
    ERDiagramSettingsPanel.currentPanel.renderSub();
  }

  async renderSub() {
    if (!this.variables) {
      return;
    }
    const msg: ERDiagramSettingsPanelEventData = {
      command: "initialize",
      componentName: "ERDiagramSettingsPanel",
      value: {
        initialize: {
          params: this.variables,
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
    ERDiagramSettingsPanel.currentPanel = undefined;
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
        log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
        switch (command) {
          case "cancel":
            this.dispose();
            return;
          case "writeToClipboard":
            this.writeToClipboard(params);
            return;
          case "createERDiagram":
            this.createERDiagram(params);
            this.dispose();
            return;
        }
      },
      undefined,
      this._disposables
    );
  }

  private async writeToClipboard(params: WriteToClipboardParams<ERDiagramSettingParams>) {
    const { options } = params;
    if (!options || !this.variables) {
      return;
    }
    const erParams = createERDiagramParams(this.variables.tables, options);
    const content = createErDiagram(erParams);
    env.clipboard.writeText(content);
  }

  private async createERDiagram(options: ERDiagramSettingParams) {
    if (!this.variables) {
      return;
    }
    const erParams = createERDiagramParams(this.variables.tables, options);
    const content = createErDiagram(erParams);
    const cell = new NotebookCellData(NotebookCellKind.Markup, content, "markdown");

    commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
  }
}
