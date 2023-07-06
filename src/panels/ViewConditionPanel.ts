import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import {
  DBDriverResolver,
  DbTable,
  MultipleValueViewConditionItem,
  NoValueViewConditionItem,
  RDSBaseDriver,
  SingleValueViewConditionItem,
  toViewDataQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ToWebviewMessageEventType } from "../types/ToWebviewMessageEvent";
import { StateStorage } from "../utilities/StateStorage";
import { ActionCommand } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { MdhPanel } from "./MdhPanel";
import { ViewConditionParams } from "../shared/ViewConditionParams";

const PREFIX = "[ViewConditionPanel]";

const componentName = "ViewConditionPanel";

export class ViewConditionPanel {
  public static currentPanel: ViewConditionPanel | undefined;
  private static stateStorage?: StateStorage;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private tableRes: DbTable | undefined;
  private numOfRows: number = 0;

  private constructor(panel: WebviewPanel, private extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(this._panel.webview, this.extensionUri);
    this._setWebviewMessageListener(this._panel.webview);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    ViewConditionPanel.currentPanel = new ViewConditionPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    ViewConditionPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, tableRes: DbTable, numOfRows: number) {
    log(`${PREFIX} render`);
    if (ViewConditionPanel.currentPanel) {
      ViewConditionPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "ViewConditionPanelType",
        "View condition settings",
        ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      ViewConditionPanel.currentPanel = new ViewConditionPanel(panel, extensionUri);
    }
    ViewConditionPanel.currentPanel.tableRes = tableRes;
    ViewConditionPanel.currentPanel.numOfRows = numOfRows;
    ViewConditionPanel.currentPanel.renderSub();
  }

  async renderSub() {
    // send to webview
    const msg: ToWebviewMessageEventType = {
      command: "create",
      componentName,
      value: {
        tableRes: this.tableRes,
        limit: Math.min(1000, this.numOfRows),
        numOfRows: this.numOfRows,
      },
    };

    this._panel.webview.postMessage(msg);
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    log(`${PREFIX} dispose`);
    ViewConditionPanel.currentPanel = undefined;
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
              const p = params as ViewConditionParams;
              const { tableRes } = this;
              if (!tableRes || !ViewConditionPanel.stateStorage) {
                return;
              }
              const { conName, schemaName } = tableRes.meta;
              const setting = await ViewConditionPanel.stateStorage.getConnectionSettingByName(
                conName
              );
              if (!setting) {
                return;
              }

              const { ok, message, result } =
                await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
                  setting,
                  async (driver) => {
                    const { query, binds } = toViewDataQuery({
                      tableRes,
                      schemaName,
                      toPositionedParameter: driver.isPositionedParameterAvailable(),
                      conditions: {
                        andOr: p.andOr,
                        items: p.conditions.map((it) => {
                          const { column, operator, value } = it;
                          switch (it.operator) {
                            case "isNull":
                            case "isNotNull":
                              return {
                                column,
                                operator,
                              } as NoValueViewConditionItem;
                            case "in":
                            case "notIn":
                              return {
                                column,
                                operator,
                                values: value.match(/(\\.|[^,])+/g)?.map((s) => s.trim()),
                              } as MultipleValueViewConditionItem;
                            default:
                              return {
                                column,
                                operator,
                                value,
                              } as SingleValueViewConditionItem;
                          }
                        }),
                      },
                    });
                    log(`${PREFIX} query:[${query}]`);
                    log(`${PREFIX} binds:[${binds}]`);
                    return await driver.requestSql({
                      sql: query,
                      conditions: {
                        binds,
                        maxRows: p.limit,
                      },
                      meta: {
                        tableName: tableRes.name,
                        compareKeys: tableRes.getCompareKeys(),
                        comment: tableRes.comment,
                        editable: p.editable,
                      },
                    });
                  }
                );
              if (ok && result) {
                MdhPanel.render(this.extensionUri, tableRes.name, [result]);
              } else {
                window.showErrorMessage(message);
              }
            }
            this.dispose();
            return;
        }
      },
      undefined,
      this._disposables
    );
  }
}
