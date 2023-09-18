import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import {
  DBDriverResolver,
  RDSBaseDriver,
  ResultSetData,
  ResultSetDataBuilder,
  resolveCodeLabel,
  runRuleEngine,
  toDeleteStatement,
  toInsertStatement,
  toUpdateStatement,
} from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";

import { createBookFromList } from "../utilities/excelGenerator";
import { createHash } from "crypto";
import {
  ActionCommand,
  CompareParams,
  OutputParams,
  SaveValuesParams,
  WriteToClipboardParams,
} from "../shared/ActionParams";
import { SHOW_RDH_DIFF } from "../constant";
import { DiffTabParam } from "./DiffPanel";
import { log, logError } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { rdhListToText } from "../utilities/rdhToText";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { WriteToClipboardParamsPanel } from "./WriteToClipboardParamsPanel";
import { ComponentName } from "../shared/ComponentName";
import { MdhPanelEventData, RdhTabItem } from "../shared/MessageEventData";

const PREFIX = "[MdhPanel]";

dayjs.extend(utc);

const componentName: ComponentName = "MdhPanel";

/**
 * This class manages the state and behavior of HelloWorld webview panels.
 */
export class MdhPanel {
  public static currentPanel: MdhPanel | undefined;
  private static stateStorage?: StateStorage;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private items: RdhTabItem[] = [];

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
    MdhPanel.currentPanel = new MdhPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    MdhPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, title: string, list: ResultSetData[]) {
    // log(`${PREFIX} render title:[${title}]`);
    if (MdhPanel.currentPanel) {
      MdhPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel("ResultSetsType", "Resultsets", ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          Uri.joinPath(extensionUri, "out"),
          Uri.joinPath(extensionUri, "webview-ui/build"),
        ],
      });
      MdhPanel.currentPanel = new MdhPanel(panel, extensionUri);
    }
    // vscode.window.activeColorTheme.kind===ColorThemeKind.Dark
    MdhPanel.currentPanel.renderSub(
      title,
      list.map((it) => ResultSetDataBuilder.from(it).build())
    );
  }

  private createTabItem(title: string, list: ResultSetData[]): RdhTabItem {
    const tabId = createHash("md5").update(title).digest("hex");
    const refreshable = list.every((it) => it.meta.type === "select" || it.meta.type === "show");
    const item: RdhTabItem = {
      tabId,
      title,
      list,
      refreshable,
    };
    return item;
  }

  private getTabByTitle(title: string): RdhTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }

  async renderSub(title: string, list: ResultSetData[]): Promise<RdhTabItem | undefined> {
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      item.list = list;
      const msg: MdhPanelEventData = {
        command: "set-search-result",
        componentName: "MdhPanel",
        value: {
          searchResult: {
            tabId: item.tabId,
            value: item.list,
          },
        },
      };
      this._panel.webview.postMessage(msg);
      return item;
    }

    item = this.createTabItem(title, list);
    this.items.push(item);

    const msg2: MdhPanelEventData = {
      command: "add-tab-item",
      componentName: "MdhPanel",
      value: {
        addTabItem: item,
      },
    };
    this._panel.webview.postMessage(msg2);
    return item;
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    log(`${PREFIX} dispose`);

    MdhPanel.currentPanel = undefined;
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
        switch (command) {
          case "closeTab":
            {
              const { tabId } = params;
              const idx = this.items.findIndex((it) => it.tabId === tabId);
              if (idx >= 0) {
                this.items.splice(idx, 1);
              }
              if (this.items.length === 0) {
                this.dispose();
              }
            }
            break;
          case "selectTab":
            {
              hideStatusMessage();
            }
            break;
          case "selectInnerTab":
            {
              const { tabId, innerIndex } = params;
              const tabItem = this.getTabItemById(tabId);
              if (!tabItem) {
                return;
              }
              const count = tabItem.list[innerIndex].rows.length;
              if (count === 0) {
                showStatusMessage(`No rows`);
              } else {
                showStatusMessage(`Total:${tabItem.list[innerIndex].rows.length} rows`);
              }
            }
            break;
          case "refresh":
            this.refresh(params);
            return;
          case "compare":
            this.compare(params);
            return;
          case "saveCompareKeys":
            {
              const { tabId, list } = params;
              const tabItem = this.getTabItemById(tabId);
              if (!tabItem) {
                return;
              }
              list.forEach((item) => {
                const meta = tabItem.list[item.index].meta;
                if (meta.compareKeys === undefined) {
                  meta.compareKeys = [];
                }
                meta.compareKeys.splice(0, meta.compareKeys.length);
                meta.compareKeys.push({
                  kind: "custom",
                  names: item.compareKeyNames,
                });
              });
              const msg: MdhPanelEventData = {
                command: "set-search-result",
                componentName: "MdhPanel",
                value: {
                  searchResult: {
                    tabId,
                    value: tabItem.list,
                  },
                },
              };
              this._panel.webview.postMessage(msg);
            }
            return;
          case "saveValues":
            this.saveValues(params);
            break;
          case "output":
            this.output(params);
            return;
          case "showError":
            await window.showErrorMessage(params.message);
            return;
          case "writeToClipboard":
            this.writeToClipboard(params);
            return;
        }
      },
      undefined,
      this._disposables
    );
  }

  private async saveValues(params: SaveValuesParams) {
    const tabItem = this.getTabItemById(params.tabId);
    if (!tabItem) {
      return;
    }
    const rdh = tabItem.list[0];
    const { connectionName, tableName } = rdh.meta;
    if (connectionName === undefined || tableName === undefined) {
      return;
    }
    const setting = await MdhPanel.stateStorage?.getConnectionSettingByName(connectionName);
    if (!setting) {
      return;
    }

    const { insertList, updateList, deleteList } = params;
    const totalCount = insertList.length + updateList.length + deleteList.length;
    const increment = Math.floor(100 / totalCount);
    const { ok, message } = await window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        return await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
          setting,
          async (driver) => {
            const toPositionedParameter = driver.isPositionedParameterAvailable();
            let errorMessage = "";
            for (let i = 0; i < insertList.length; i++) {
              const prefix = `INSERT[${i + 1}/${insertList.length}] `;
              const { values } = insertList[i];
              try {
                const { query, binds } = toInsertStatement({
                  tableName,
                  columns: rdh.keys,
                  values,
                  bindOption: {
                    specifyValuesWithBindParameters: true,
                    toPositionedParameter,
                  },
                });
                log(`${prefix} sql:[${query}]`);
                log(`${prefix} binds:${JSON.stringify(binds)}`);

                const r = await driver.requestSql({
                  sql: query,
                  conditions: {
                    binds,
                  },
                });
                log(`${prefix} OK`);
              } catch (e: any) {
                errorMessage = e.message;
                logError(`${prefix} NG:${e.message}`);
              }
              progress.report({
                message: `Inserted [${i + 1}/${insertList.length}]`,
                increment,
              });
            }

            for (let i = 0; i < updateList.length; i++) {
              const prefix = `UPDATE[${i + 1}/${updateList.length}] `;
              const { values, conditions } = updateList[i];
              try {
                const { query, binds } = toUpdateStatement({
                  tableName,
                  columns: rdh.keys,
                  values,
                  conditions,
                  bindOption: {
                    specifyValuesWithBindParameters: true,
                    toPositionedParameter,
                  },
                });

                log(`${prefix} sql:[${query}]`);
                log(`${prefix} binds:${JSON.stringify(binds)}`);

                const r = await driver.requestSql({
                  sql: query,
                  conditions: {
                    binds,
                  },
                });
                log(`${prefix} OK`);
              } catch (e: any) {
                errorMessage = e.message;
                logError(`${prefix} NG:${e.message}`);
              }
              progress.report({
                message: `Updated [${i + 1}/${insertList.length}]`,
                increment,
              });
            }

            for (let i = 0; i < deleteList.length; i++) {
              const prefix = `DELETE[${i + 1}/${deleteList.length}] `;
              const { conditions } = deleteList[i];
              try {
                const { query, binds } = toDeleteStatement({
                  tableName,
                  columns: rdh.keys,
                  conditions,
                  bindOption: {
                    specifyValuesWithBindParameters: true,
                    toPositionedParameter,
                  },
                });
                log(`${prefix} sql:[${query}]`);
                log(`${prefix} binds:${JSON.stringify(binds)}`);

                const r = await driver.requestSql({
                  sql: query,
                  conditions: {
                    binds,
                  },
                });
                log(`${prefix} OK`);
              } catch (e: any) {
                errorMessage = e.message;
                logError(`${prefix} NG:${e.message}`);
              }
              progress.report({
                message: `Deleted [${i + 1}/${insertList.length}]`,
                increment,
              });
            }

            progress.report({
              increment: 100,
            });
            if (errorMessage) {
              throw new Error(errorMessage);
            }
          }
        );
      }
    );
    if (ok) {
      window.showInformationMessage("OK");
      this.refresh(params);
    } else if (message) {
      window.showErrorMessage(message);
    }
  }

  private async output(data: OutputParams) {
    const { tabId } = data;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const { title } = tabItem;
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${title}.xlsx`;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: Uri.file(path.join("./", defaultFileName)),
      filters: { "*": ["xlsx"] },
    });
    if (!uri) {
      return;
    }
    const message = await createBookFromList(tabItem.list, uri.fsPath, {
      rdh: {
        outputAllOnOneSheet: true,
        outputWithType: data.outputWithType,
      },
      rule: {
        withRecordRule: true,
      },
    });
    if (message) {
      vscode.window.showErrorMessage(message);
    } else {
      vscode.window.showInformationMessage(uri.fsPath);
    }
  }

  private async writeToClipboard(params: WriteToClipboardParams) {
    const { tabId } = params;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    if (params.specifyDetail === true) {
      WriteToClipboardParamsPanel.render(this.extensionUri, tabItem.list, params);
    } else {
      await vscode.env.clipboard.writeText(rdhListToText(tabItem.list, params));
    }
  }

  private async compare(params: CompareParams) {
    const tabItem = this.getTabItemById(params.tabId);
    if (!tabItem) {
      return;
    }
    const { list } = tabItem;
    const conNames = [...new Set(list.map((it) => it.meta.connectionName + ""))];
    const beforeList = list.map((it) => ResultSetDataBuilder.from(it).build());
    const afterList = list.map((it) => undefined as ResultSetData | undefined);

    await window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        for (const conName of conNames) {
          const setting = await MdhPanel.stateStorage?.getConnectionSettingByName(conName);
          if (!setting) {
            continue;
          }

          const { ok, message } = await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
            setting,
            async (driver) => {
              for (let i = 0; i < beforeList.length; i++) {
                if (beforeList[i].meta.connectionName !== conName) {
                  continue;
                }
                const rdh = beforeList[i];
                const sql = rdh.sqlStatement!;

                progress.report({
                  message: `Select current content of ${rdh.meta.tableName}`,
                });
                if (token.isCancellationRequested) {
                  return;
                }

                const afterRdh = await driver.requestSql({
                  sql,
                  conditions: rdh.queryConditions,
                  meta: rdh.meta,
                });
                if (rdh.meta.tableRule) {
                  afterRdh.meta.tableRule = rdh.meta.tableRule;
                }
                if (rdh.meta.codeItems) {
                  afterRdh.meta.codeItems = rdh.meta.codeItems;
                }
                afterList[i] = afterRdh;
              }
            }
          );

          if (!ok) {
            vscode.window.showErrorMessage(message);
          }
        }

        progress.report({
          increment: 100,
        });
      }
    );
    const diffParams: DiffTabParam = {
      title: tabItem.title,
      list1: beforeList,
      list2: afterList.map((it) => it!),
    };
    if (afterList.some((it) => it === undefined)) {
      console.log("L353 no after list");
      return;
    }
    vscode.commands.executeCommand(SHOW_RDH_DIFF, diffParams);
  }

  private getTabItemById(tabId: string): RdhTabItem | undefined {
    return this.items.find((it) => it.tabId === tabId);
  }

  private async refresh({ tabId }: { tabId: string }) {
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const { list } = tabItem;
    const conNames = [...new Set(list.map((it) => it.meta.connectionName + ""))];
    for (const conName of conNames) {
      const setting = await MdhPanel.stateStorage?.getConnectionSettingByName(conName);
      if (!setting) {
        continue;
      }

      const { ok, message } = await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
        setting,
        async (driver) => {
          for (let i = 0; i < tabItem.list.length; i++) {
            if (tabItem.list[i].meta.connectionName !== conName) {
              continue;
            }

            const rdh = tabItem.list[i];
            const { type } = rdh.meta;
            const sql = rdh.sqlStatement!;
            const newRdh = await driver.requestSql({
              sql,
              conditions: rdh.queryConditions,
              meta: rdh.meta,
            });
            if (rdh.meta.tableRule) {
              newRdh.meta.tableRule = rdh.meta.tableRule;
              await runRuleEngine(newRdh);
            }
            if (rdh.meta.codeItems) {
              newRdh.meta.codeItems = rdh.meta.codeItems;
              await resolveCodeLabel(newRdh);
            }

            tabItem.list[i] = newRdh;
          }
        }
      );

      if (!ok) {
        vscode.window.showErrorMessage(message);
      }
    }
    const msg: MdhPanelEventData = {
      command: "set-search-result",
      componentName: "MdhPanel",
      value: {
        searchResult: {
          tabId,
          value: tabItem.list,
        },
      },
    };
    this._panel.webview.postMessage(msg);
  }
}
