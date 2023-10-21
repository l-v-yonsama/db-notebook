import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn, ThemeIcon } from "vscode";
import * as vscode from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";

import { createHash } from "crypto";
import { ActionCommand, OutputParams, WriteToClipboardParams } from "../shared/ActionParams";
import { log, logError } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { WriteToClipboardParamsPanel } from "./WriteToClipboardParamsPanel";
import { ComponentName } from "../shared/ComponentName";
import { HttpResponseTabItem, HttpResponsesPanelEventData } from "../shared/MessageEventData";
import { getIconPath } from "../utilities/fsUtil";
import { NodeRunAxiosResponse } from "../shared/RunResultMetadata";

const PREFIX = "[HttpResponsesPanel]";

dayjs.extend(utc);

const componentName: ComponentName = "HttpResponsesPanel";

export class HttpResponsesPanel {
  public static currentPanel: HttpResponsesPanel | undefined;
  private static stateStorage?: StateStorage;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private items: HttpResponseTabItem[] = [];

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
    HttpResponsesPanel.currentPanel = new HttpResponsesPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    HttpResponsesPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, title: string, list: NodeRunAxiosResponse[]) {
    log(`${PREFIX} render title:[${title}]`);
    if (HttpResponsesPanel.currentPanel) {
      HttpResponsesPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "HttpResponsesType",
        "HttpResponses",
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
      HttpResponsesPanel.currentPanel = new HttpResponsesPanel(panel, extensionUri);
    }
    // vscode.window.activeColorTheme.kind===ColorThemeKind.Dark
    HttpResponsesPanel.currentPanel.renderSub(title, list.slice());
  }

  private createTabItem(title: string, list: NodeRunAxiosResponse[]): HttpResponseTabItem {
    const tabId = createHash("md5").update(title).digest("hex");
    const item: HttpResponseTabItem = {
      tabId,
      title,
      list,
    };
    return item;
  }

  private getTabByTitle(title: string): HttpResponseTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }

  async renderSub(
    title: string,
    list: NodeRunAxiosResponse[]
  ): Promise<HttpResponseTabItem | undefined> {
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      item.list = list;
      const msg: HttpResponsesPanelEventData = {
        command: "set-response",
        componentName: "HttpResponsesPanel",
        value: {
          searchResponse: {
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

    const msg2: HttpResponsesPanelEventData = {
      command: "add-tab-item",
      componentName: "HttpResponsesPanel",
      value: {
        addTabItem: item,
      },
    };
    this._panel.webview.postMessage(msg2);
    return item;
  }

  public dispose() {
    log(`${PREFIX} dispose`);

    HttpResponsesPanel.currentPanel = undefined;
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
              // const count = tabItem.list[innerIndex].rows.length;
              // if (count === 0) {
              //   showStatusMessage(`No rows`);
              // } else {
              //   showStatusMessage(`Total:${tabItem.list[innerIndex].rows.length} rows`);
              // }
            }
            break;
          case "refresh":
            this.refresh(params);
            return;
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
    // const message = await createBookFromList(tabItem.list, uri.fsPath, {
    //   rdh: {
    //     outputAllOnOneSheet: true,
    //     outputWithType: data.outputWithType,
    //   },
    //   rule: {
    //     withRecordRule: true,
    //   },
    // });
    // if (message) {
    //   vscode.window.showErrorMessage(message);
    // } else {
    //   vscode.window.showInformationMessage(uri.fsPath);
    // }
  }

  private async writeToClipboard(params: WriteToClipboardParams) {
    const { tabId } = params;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    // if (params.specifyDetail === true) {
    //   WriteToClipboardParamsPanel.render(this.extensionUri, tabItem.list, params);
    // } else {
    //   await vscode.env.clipboard.writeText(rdhListToText(tabItem.list, params));
    // }
  }

  private getTabItemById(tabId: string): HttpResponseTabItem | undefined {
    return this.items.find((it) => it.tabId === tabId);
  }

  private async refresh({ tabId }: { tabId: string }) {
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    // const { list } = tabItem;
    // const conNames = [...new Set(list.map((it) => it.meta.connectionName + ""))];
    // for (const conName of conNames) {
    //   const setting = await HttpResponsesPanel.stateStorage?.getConnectionSettingByName(conName);
    //   if (!setting) {
    //     continue;
    //   }

    //   const { ok, message } = await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
    //     setting,
    //     async (driver) => {
    //       for (let i = 0; i < tabItem.list.length; i++) {
    //         if (tabItem.list[i].meta.connectionName !== conName) {
    //           continue;
    //         }

    //         const rdh = tabItem.list[i];
    //         const { type } = rdh.meta;
    //         const sql = rdh.sqlStatement!;
    //         const newRdh = await driver.requestSql({
    //           sql,
    //           conditions: rdh.queryConditions,
    //           meta: rdh.meta,
    //         });
    //         if (rdh.meta.tableRule) {
    //           newRdh.meta.tableRule = rdh.meta.tableRule;
    //           await runRuleEngine(newRdh);
    //         }
    //         if (rdh.meta.codeItems) {
    //           newRdh.meta.codeItems = rdh.meta.codeItems;
    //           await resolveCodeLabel(newRdh);
    //         }

    //         tabItem.list[i] = newRdh;
    //       }
    //     }
    //   );

    //   if (!ok) {
    //     vscode.window.showErrorMessage(message);
    //   }
    // }
    // const msg: MdhPanelEventData = {
    //   command: "set-search-result",
    //   componentName: "MdhPanel",
    //   value: {
    //     searchResult: {
    //       tabId,
    //       value: tabItem.list,
    //     },
    //   },
    // };
    // this._panel.webview.postMessage(msg);
  }
}
