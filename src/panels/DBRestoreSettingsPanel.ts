import { AllSubDbResource, DbResource } from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, ViewColumn, WebviewPanel, env, window } from "vscode";
import { ActionCommand, WriteToClipboardParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { DBRestoreInputParams, DBRestoreSettingsUIParams } from "../shared/DBRestoreParams";
import { ERDiagramSettingParams } from "../shared/ERDiagram";
import { DBRestoreSettingsPanelEventData } from "../shared/MessageEventData";
import { DockerContainerSummary } from "../types/Docker";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import {
  buildDockerContainerItems,
  listRunningDockerContainers,
} from "../utilities/dockerContainerUtil";
import { log } from "../utilities/logger";
import { buildRestoreCommand } from "../utilities/restoreCommandBuilder";
import { StateStorage } from "../utilities/StateStorage";
import { createPreferredTerminal } from "../utilities/terminalUtil";
import { BasePanel } from "./BasePanel";

const PREFIX = "[DBRestoreSettingsPanel]";

export class DBRestoreSettingsPanel extends BasePanel {
  public static currentPanel: DBRestoreSettingsPanel | undefined;
  private static stateStorage?: StateStorage;
  private dbRes: DbResource | undefined;
  private variables: DBRestoreInputParams | undefined;
  private uiParams: DBRestoreSettingsUIParams = {
    dockerContainerItems: [],
    previewCommand: "",
    scrollPos: 0,
  };
  private dockerContainers: DockerContainerSummary[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    DBRestoreSettingsPanel.currentPanel = new DBRestoreSettingsPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    DBRestoreSettingsPanel.stateStorage = storage;
  }

  getComponentName(): ComponentName {
    return "DBRestoreSettingsPanel";
  }

  public static render(extensionUri: Uri, dbRes: DbResource) {
    log(`${PREFIX} render`);
    if (DBRestoreSettingsPanel.currentPanel) {
      DBRestoreSettingsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "DBRestoreSettingsType",
        "DB Restore Settings",
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
      DBRestoreSettingsPanel.currentPanel = new DBRestoreSettingsPanel(panel, extensionUri);
    }
    DBRestoreSettingsPanel.currentPanel.dbRes = dbRes;
    DBRestoreSettingsPanel.currentPanel.renderSub();
  }

  private resetPreviewCommand() {
    if (!this.variables) {
      return;
    }

    // preview 用 → マスクあり
    this.uiParams.previewCommand = buildRestoreCommand(this.variables, true);
  }

  private async createInputParams(
    dbRes: DbResource<AllSubDbResource>
  ): Promise<DBRestoreInputParams> {
    if (!DBRestoreSettingsPanel.stateStorage) {
      throw new Error("Missing stateStorage");
    }
    const { conName } = dbRes.meta;
    const con = await DBRestoreSettingsPanel.stateStorage.getConnectionSettingByName(conName);
    if (!con) {
      throw new Error("Missing Connection setting");
    }
    this.uiParams.previewCommand = "";

    return {
      dbName: dbRes.name,
      dbType: con.dbType,
      executeRestoreInDockerContainer: false,
      dockerContainerName: "",
      userName: con.user ?? "",
      password: con.password ?? "",
      inputFilePath: "",
      fileCompression: "none",
      advanced: {
        showProgress: false,
        verbose: false,
      },
    };
  }

  async renderSub() {
    if (!this.dbRes) {
      return;
    }
    this.variables = await this.createInputParams(this.dbRes);
    await this.resetDockerParams();
    this.resetPreviewCommand();

    const msg: DBRestoreSettingsPanelEventData = {
      command: "initialize",
      componentName: "DBRestoreSettingsPanel",
      value: {
        initialize: {
          params: this.variables,
          uiParams: this.uiParams,
        },
      },
    };

    this.getWebviewPanel().webview.postMessage(msg);
  }

  protected preDispose(): void {
    DBRestoreSettingsPanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "writeToClipboard":
        this.writeToClipboard(params);
        return;
      case "inputChange":
        this.handleChange(params);
        return;
      case "selectFileActionCommand":
        {
          const { targetAttribute, ...others } = params;
          const r = await window.showOpenDialog({
            ...others,
          });

          if (r && r.length && this.variables) {
            const filePath = r[0].fsPath;
            this.variables.inputFilePath = filePath;
            if (filePath.endsWith(".gz") || filePath.endsWith(".gzip")) {
              this.variables.fileCompression = "gzip";
            } else if (filePath.endsWith(".zstd") || filePath.endsWith(".zst")) {
              this.variables.fileCompression = "zstd";
            } else if (filePath.endsWith(".sql")) {
              this.variables.fileCompression = "none";
            }
          }
          await this.resetDockerParams();
          this.resetPreviewCommand();
          const msg: DBRestoreSettingsPanelEventData = {
            command: "initialize",
            componentName: "DBRestoreSettingsPanel",
            value: {
              initialize: {
                params: this.variables!,
                uiParams: this.uiParams,
              },
            },
          };

          this.getWebviewPanel().webview.postMessage(msg);
        }
        break;
      case "ok":
        this.dumpOnTerminal();
        return;
    }
  }

  private async dumpOnTerminal(): Promise<void> {
    if (!this.variables) {
      return;
    }

    const command = buildRestoreCommand(this.variables, false);
    const { inputFilePath } = this.variables;

    if (!command) {
      showWindowErrorMessage("Restore command is empty.");
      return;
    }

    try {
      // 既存の同名ターミナルがあれば再利用
      const terminalName = "DB Restore";
      let terminal = window.terminals.find((t) => t.name === terminalName);

      if (!terminal) {
        terminal = createPreferredTerminal(terminalName);
      }

      // ターミナルを前面に表示
      terminal.show(true);

      // 視認性向上用のコメント（shell によっては無視される）
      terminal.sendText(`echo "===== DB Restore Started: ${inputFilePath} ====="`, true);

      // 実際の dump コマンド送信
      terminal.sendText(command, true);
    } catch (e) {
      showWindowErrorMessage(e);
    }
  }

  private async handleChange(params: Partial<DBRestoreInputParams>) {
    if (!this.variables) {
      return;
    }

    this.variables.inputFilePath = params.inputFilePath!;
    this.variables.fileCompression = params.fileCompression!;
    this.variables.userName = params.userName!;
    this.variables.password = params.password!;
    this.variables.host = params.host;
    this.variables.port = params.port;
    this.variables.advanced = params.advanced!;
    this.variables.sqliteOption = {
      ...params.sqliteOption!,
    };

    if (this.variables.dbType !== "SQLite") {
      this.variables.executeRestoreInDockerContainer = params.executeRestoreInDockerContainer!;
      this.variables.dockerContainerName = params.dockerContainerName!;
    }

    this.uiParams.scrollPos = (params as any).scrollPos;

    await this.resetDockerParams();
    this.resetPreviewCommand();
    const msg: DBRestoreSettingsPanelEventData = {
      command: "initialize",
      componentName: "DBRestoreSettingsPanel",
      value: {
        initialize: {
          params: this.variables,
          uiParams: this.uiParams,
        },
      },
    };

    this.getWebviewPanel().webview.postMessage(msg);
  }

  private async writeToClipboard(params: WriteToClipboardParams<ERDiagramSettingParams>) {
    if (!this.variables) {
      return;
    }

    const command = buildRestoreCommand(this.variables, false);

    if (!command) {
      showWindowErrorMessage("Restore command is empty.");
      return;
    }
    env.clipboard.writeText(command);
  }

  private async resetDockerParams(): Promise<void> {
    if (!this.variables) {
      return;
    }

    const { dbType, executeRestoreInDockerContainer } = this.variables;
    // ★ SQLite では Docker は無効
    if (dbType === "SQLite") {
      this.variables.executeRestoreInDockerContainer = false;
      this.variables.dockerContainerName = "";
      this.uiParams.dockerContainerItems = [];
      return;
    }

    if (!executeRestoreInDockerContainer) {
      return;
    }

    if (this.dockerContainers.length === 0) {
      try {
        this.dockerContainers = await listRunningDockerContainers();
      } catch (e) {
        showWindowErrorMessage(e);
        return;
      }
    }

    this.uiParams.dockerContainerItems = buildDockerContainerItems(this.dockerContainers, dbType);
  }
}
