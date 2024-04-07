import {
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
import { ERDiagramSettingParams } from "../shared/ERDiagram";
import { createERDiagramParams, createErDiagram } from "../utilities/erDiagramGenerator";
import { CREATE_NEW_NOTEBOOK } from "../constant";
import { ComponentName } from "../shared/ComponentName";
import {
  ERDiagramSettingsInputParams,
  ERDiagramSettingsPanelEventData,
} from "../shared/MessageEventData";
import { BasePanel } from "./BasePanel";

const PREFIX = "[ERDiagramSettingsPanel]";

dayjs.extend(utc);

export class ERDiagramSettingsPanel extends BasePanel {
  public static currentPanel: ERDiagramSettingsPanel | undefined;
  private static stateStorage?: StateStorage;
  private variables: ERDiagramSettingsInputParams | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    ERDiagramSettingsPanel.currentPanel = new ERDiagramSettingsPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    ERDiagramSettingsPanel.stateStorage = storage;
  }

  getComponentName(): ComponentName {
    return "ERDiagramSettingsPanel";
  }

  public static render(extensionUri: Uri, params: ERDiagramSettingsInputParams) {
    log(`${PREFIX} render`);
    if (ERDiagramSettingsPanel.currentPanel) {
      ERDiagramSettingsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
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

    this.getWebviewPanel().webview.postMessage(msg);
  }

  protected preDispose(): void {
    ERDiagramSettingsPanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    // log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
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
