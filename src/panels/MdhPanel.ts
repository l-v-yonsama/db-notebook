import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import {
  DBDriverResolver,
  RDSBaseDriver,
  ResultSetDataHolder,
} from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { ToWebviewMessageEventType } from "../types/ToWebviewMessageEvent";
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
  WriteToClipboardParams,
} from "../shared/ActionParams";
import { SHOW_RDH_DIFF } from "../constant";
import { DiffTabParam } from "./DiffPanel";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { rdhListToText, rdhToText } from "../utilities/rdhToText";
import { hideStatusMessage, showStatusMessage } from "../statusBar";

const PREFIX = "[MdhPanel]";

dayjs.extend(utc);

const componentName = "MdhPanel";

type RdhTabItem = {
  tabId: string;
  title: string;
  list: ResultSetDataHolder[];
};

/**
 * This class manages the state and behavior of HelloWorld webview panels.
 */
export class MdhPanel {
  public static currentPanel: MdhPanel | undefined;
  private static stateStorage?: StateStorage;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private items: RdhTabItem[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(this._panel.webview, extensionUri);
    this._setWebviewMessageListener(this._panel.webview);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    MdhPanel.currentPanel = new MdhPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    MdhPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, title: string, list: ResultSetDataHolder[]) {
    log(`${PREFIX} render title:[${title}]`);
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
    //               vscode.window.activeColorTheme.kind===ColorThemeKind.Dark
    MdhPanel.currentPanel.renderSub(
      title,
      list.map((it) => ResultSetDataHolder.from(it))
    );
  }

  private createTabItem(title: string, list: ResultSetDataHolder[]): RdhTabItem {
    const tabId = createHash("md5").update(title).digest("hex");
    const item: RdhTabItem = {
      tabId,
      title,
      list,
    };
    return item;
  }

  private getTabByTitle(title: string): RdhTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }

  async renderSub(title: string, list: ResultSetDataHolder[]): Promise<RdhTabItem | undefined> {
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      item.list = list;
      const msg: ToWebviewMessageEventType = {
        command: componentName + "-set-search-result",
        value: {
          tabId: item.tabId,
          value: item.list,
        },
      };
      this._panel.webview.postMessage(msg);
      return item;
    }

    item = this.createTabItem(title, list);
    this.items.push(item);

    // send to webview
    const msg: ToWebviewMessageEventType = {
      command: "create",
      componentName,
    };

    this._panel.webview.postMessage(msg);

    const msg2: ToWebviewMessageEventType = {
      command: componentName + "-add-tab-item",
      value: item,
    };
    this._panel.webview.postMessage(msg2);
    return item;
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
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
        log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
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
              const msg: ToWebviewMessageEventType = {
                command: componentName + "-set-search-result",
                value: {
                  tabId,
                  value: tabItem.list,
                },
              };
              this._panel.webview.postMessage(msg);
            }
            return;
          case "output":
            this.output(params);
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
      outputWithType: data.outputWithType,
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
    await vscode.env.clipboard.writeText(rdhListToText(tabItem.list, params));
  }

  private async compare(params: CompareParams) {
    const tabItem = this.getTabItemById(params.tabId);
    if (!tabItem) {
      return;
    }
    const { list } = tabItem;
    const conNames = [...new Set(list.map((it) => it.meta.connectionName + ""))];
    const beforeList = list.map((it) => ResultSetDataHolder.from(it));
    const afterList = list.map((it) => undefined as ResultSetDataHolder | undefined);
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
            const afterRdh = await driver.requestSql({
              sql,
              conditions: rdh.queryConditions,
              meta: rdh.meta,
            });
            afterList[i] = afterRdh;
          }
        }
      );

      if (!ok) {
        vscode.window.showErrorMessage(message);
      }
    }
    if (afterList.some((it) => it === undefined)) {
      return;
    }

    const diffParams: DiffTabParam = {
      title: tabItem.title,
      list1: beforeList,
      list2: afterList.map((it) => it!),
    };
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
            const sql = rdh.sqlStatement!;
            const newRdh = await driver.requestSql({
              sql,
              conditions: rdh.queryConditions,
              meta: rdh.meta,
            });
            tabItem.list[i] = newRdh;
          }
        }
      );

      if (!ok) {
        vscode.window.showErrorMessage(message);
      }
    }
    const msg: ToWebviewMessageEventType = {
      command: componentName + "-set-search-result",
      value: {
        tabId,
        value: tabItem.list,
      },
    };
    this._panel.webview.postMessage(msg);
  }
}
