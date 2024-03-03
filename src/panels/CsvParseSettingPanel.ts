import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn, ThemeIcon } from "vscode";
import * as vscode from "vscode";

import { ActionCommand, SaveCsvOptionParams } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { ComponentName } from "../shared/ComponentName";
import { CsvParseSettingPanelEventData } from "../shared/MessageEventData";
import { getIconPath } from "../utilities/fsUtil";

import {
  parseCsvFromFile,
  CsvParseOptions,
  ResultSetDataBuilder,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { basename } from "path";
import { MdhViewParams } from "../types/views";
import { OPEN_MDH_VIEWER } from "../constant";

const PREFIX = "[CsvParseSettingPanel]";

const componentName: ComponentName = "CsvParseSettingPanel";

export class CsvParseSettingPanel {
  public static currentPanel: CsvParseSettingPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private csvUri: Uri | undefined;
  private csvOptions: CsvParseOptions | undefined;

  private constructor(panel: WebviewPanel, private extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(
      this._panel.webview,
      this.extensionUri,
      componentName
    );
    this._setWebviewMessageListener(this._panel.webview);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    CsvParseSettingPanel.currentPanel = new CsvParseSettingPanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, csvUri: Uri) {
    if (CsvParseSettingPanel.currentPanel) {
      CsvParseSettingPanel.currentPanel._panel.reveal(ViewColumn.Two);
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
      this._panel.webview.postMessage(msg);
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
      this._panel.webview.postMessage(msg);
    }
  }

  public dispose() {
    log(`${PREFIX} dispose`);

    CsvParseSettingPanel.currentPanel = undefined;
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
      },
      undefined,
      this._disposables
    );
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
        window.showErrorMessage(e.message);
      } else {
        log(`${PREFIX} parse Error:${e}`);
        throw new Error("Parse error");
      }

      throw e;
    }
  }
}
