import { CsvParseOptions, parseCsvFromFile } from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { basename } from "path";
import * as vscode from "vscode";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { OPEN_MDH_VIEWER } from "../constant";
import { ActionCommand, SaveCsvOptionParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { CsvParseSettingPanelEventData } from "../shared/MessageEventData";
import { MdhViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { getIconPath } from "../utilities/fsUtil";
import { log } from "../utilities/logger";
import { BasePanel } from "./BasePanel";

const PREFIX = "[CsvParseSettingPanel]";

export class CsvParseSettingPanel extends BasePanel {
  public static currentPanel: CsvParseSettingPanel | undefined;
  private csvUri: Uri | undefined;
  private csvOptions: CsvParseOptions | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    CsvParseSettingPanel.currentPanel = new CsvParseSettingPanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, csvUri: Uri) {
    if (CsvParseSettingPanel.currentPanel) {
      CsvParseSettingPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "CsvParseSettingType",
        "CsvParseSetting",
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
      panel.iconPath = getIconPath("output.svg");
      CsvParseSettingPanel.currentPanel = new CsvParseSettingPanel(panel, extensionUri);
    }
    // vscode.window.activeColorTheme.kind===ColorThemeKind.Dark
    CsvParseSettingPanel.currentPanel.csvUri = csvUri;
    CsvParseSettingPanel.currentPanel.csvOptions = { columns: true, toLine: 10 };
    CsvParseSettingPanel.currentPanel.renderSub();
  }

  getComponentName(): ComponentName {
    return "CsvParseSettingPanel";
  }

  async renderSub() {
    if (!this.csvUri) {
      return;
    }

    let rdb: ResultSetDataBuilder | undefined = undefined;

    try {
      rdb = await this.parseCsv(this.csvUri.fsPath, this.csvOptions);
      const msg: CsvParseSettingPanelEventData = {
        command: "initialize",
        componentName: "CsvParseSettingPanel",
        value: {
          initialize: {
            ...this.csvOptions,
            preview: true,
          },
          rdh: rdb.build(),
        },
      };
      this.panel.webview.postMessage(msg);
    } catch (e) {
      const msg: CsvParseSettingPanelEventData = {
        command: "initialize",
        componentName: "CsvParseSettingPanel",
        value: {
          initialize: {
            ...this.csvOptions,
            preview: true,
          },
          rdh: null,
          message: (e as Error).message,
        },
      };
      this.panel.webview.postMessage(msg);
    }
  }

  public preDispose(): void {
    CsvParseSettingPanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "ok":
        {
          if (!CsvParseSettingPanel.currentPanel) {
            return;
          }
          const { preview, ...options } = params as SaveCsvOptionParams;

          if (preview) {
            CsvParseSettingPanel.currentPanel.csvOptions = {
              toLine: options.fromLine === undefined ? 10 : options.fromLine + 10,
              ...options,
            };
            await this.renderSub();
            return;
          }

          if (!this.csvUri) {
            return;
          }

          const { toLine, ...others } = this.csvOptions!;
          const rdb = await this.parseCsv(this.csvUri.fsPath, { ...others });
          const title = basename(this.csvUri.fsPath);

          const commandParam: MdhViewParams = { title, list: [rdb.build()] };
          vscode.commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
        }
        this.dispose();
        return;
    }
  }

  private async parseCsv(
    filePath: string,
    options?: CsvParseOptions
  ): Promise<ResultSetDataBuilder> {
    try {
      const rdb = await parseCsvFromFile(filePath, options);
      if (options?.cast === true) {
        rdb.resetKeyTypeByRows();
      }

      return rdb;
    } catch (e) {
      if (e instanceof Error) {
        showWindowErrorMessage(e.message);
      } else {
        log(`${PREFIX} parse Error:${e}`);
        throw new Error("Parse error");
      }

      throw e;
    }
  }
}
