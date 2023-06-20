import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  ProgressLocation,
} from "vscode";
import {
  DBDriverResolver,
  DiffResult,
  RDSBaseDriver,
  RdhHelper,
  ResultSetData,
  ResultSetDataBuilder,
  diff,
  resolveCodeLabel,
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ToWebviewMessageEventType } from "../types/ToWebviewMessageEvent";
import { StateStorage, sleep } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";
import { createHash } from "crypto";
import { ActionCommand, CompareParams, OutputParams } from "../shared/ActionParams";
import { createWebviewContent } from "../utilities/webviewUtil";
import { createBookFromDiffList } from "../utilities/excelGenerator";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { log } from "../utilities/logger";
import { nextTick } from "process";

const PREFIX = "[DiffPanel]";

dayjs.extend(utc);

const componentName = "DiffPanel";

type DiffTabInnerItem = {
  tabId: string;
  title: string;
  rdh1: ResultSetData;
  rdh2: ResultSetData;
  diffResult: DiffResult;
};

type DiffTabItem = {
  tabId: string;
  title: string;
  subTitle: string;
  list: DiffTabInnerItem[];
};

export type DiffTabParam = {
  title: string;
  list1: ResultSetData[];
  list2: ResultSetData[];
};

export class DiffPanel {
  public static currentPanel: DiffPanel | undefined;
  private static stateStorage?: StateStorage;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private items: DiffTabItem[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(this._panel.webview, extensionUri);
    this._setWebviewMessageListener(this._panel.webview);
  }

  static setStateStorage(storage: StateStorage) {
    DiffPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, params: DiffTabParam) {
    if (DiffPanel.currentPanel) {
      // If the webview panel already exists reveal it
      DiffPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        // Panel view type
        "DiffResultSetsType",
        // Panel title
        "ResultSetsDiff",
        // The editor column the panel should be displayed in
        ViewColumn.One,
        // Extra panel configurations
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      DiffPanel.currentPanel = new DiffPanel(panel, extensionUri);
    }
    //               vscode.window.activeColorTheme.kind===ColorThemeKind.Dark
    DiffPanel.currentPanel.renderSub(params);
  }

  private async createTabItem(
    title: string,
    list1: ResultSetData[],
    list2: ResultSetData[]
  ): Promise<DiffTabItem> {
    let subTitle = "";
    console.log("DiffPanel createTabItem");
    if (list1.length) {
      let before = dayjs(list1[0].created).format("HH:mm");
      let after = dayjs(list2[0].created).format("HH:mm");
      if (before === after) {
        before = dayjs(list1[0].created).format("HH:mm:ss");
        after = dayjs(list2[0].created).format("HH:mm:ss");
      }
      subTitle = `${before} ⇔ ${after}`;
    }
    list1.forEach((it) => RdhHelper.clearAllAnotations(it));
    list2.forEach((it) => RdhHelper.clearAllAnotations(it));

    const createTabId = () => createHash("md5").update(title).digest("hex");
    const tabId = createTabId();

    const item: DiffTabItem = {
      tabId,
      title,
      subTitle,
      list: [],
    };

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        const increment = list1.length === 0 ? 1 : Math.floor(100 / list1.length);
        for (let i = 0; i < list1.length; i++) {
          const rdh1 = list1[i];
          const rdh2 = list2[i];

          progress.report({
            message: `Comparing [${i + 1}/${list1.length}] ${rdh2.meta.tableName}`,
            increment,
          });
          if (token.isCancellationRequested) {
            return;
          }

          await sleep(10);
          const diffResult = diff(rdh1, rdh2);
          if (rdh2.meta.tableRule) {
            await runRuleEngine(rdh2);
          }
          if (rdh2.meta.codeItems) {
            await resolveCodeLabel(rdh2);
          }

          item.list.push({
            tabId: createTabId(),
            title: rdh1.meta.tableName ?? "",
            diffResult,
            rdh1,
            rdh2,
          });
        }
        progress.report({
          increment: 100,
        });
      }
    );

    return item;
  }

  private getTabByTitle(title: string): DiffTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }

  private getTabItemById(tabId: string): DiffTabItem | undefined {
    return this.items.find((it) => it.tabId === tabId);
  }

  async renderSub(params: DiffTabParam): Promise<DiffTabItem | undefined> {
    const { title, list1, list2 } = params;
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      const tmpItem = await this.createTabItem("tmp", list1, list2);
      item.list = tmpItem.list;
      item.subTitle = tmpItem.subTitle;

      const msg: ToWebviewMessageEventType = {
        command: componentName + "-set-search-result",
        value: {
          tabId: item.tabId,
          value: item,
        },
      };
      this._panel.webview.postMessage(msg);
      return item;
    }

    item = await this.createTabItem(title, list1, list2);
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

  public dispose() {
    log(`${PREFIX} dispose`);
    DiffPanel.currentPanel = undefined;
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
              showStatusMessage(tabItem.list[innerIndex].diffResult.message);
            }
            break;

          case "compare":
            this.compare(params);
            return;
          case "output":
            this.output(params);
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
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${title}_diff.xlsx`;
    const uri = await window.showSaveDialog({
      defaultUri: Uri.file(path.join("./", defaultFileName)),
      filters: { "*": ["xlsx"] },
    });
    if (!uri) {
      return;
    }
    const message = await createBookFromDiffList(tabItem.list, uri.fsPath, {
      rdh: {
        outputAllOnOneSheet: false,
        outputWithType: data.outputWithType,
      },
      diff: {
        displayOnlyChanged: data.displayOnlyChanged ?? false,
      },
      rule: {
        withRecordRule: true,
      },
    });
    if (message) {
      window.showErrorMessage(message);
    } else {
      window.showInformationMessage(uri.fsPath);
    }
  }

  private async compare(params: CompareParams) {
    const tabItem = this.getTabItemById(params.tabId);
    if (!tabItem) {
      return;
    }

    const baseList =
      params.base === "after"
        ? tabItem.list.map((it) => it.rdh2)
        : tabItem.list.map((it) => it.rdh1);
    const conNames = [...new Set(baseList.map((it) => it.meta.connectionName + ""))];
    const beforeList = baseList.map((it) => ResultSetDataBuilder.from(it).build());
    const afterList = baseList.map((it) => undefined as ResultSetData | undefined);

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        for (const conName of conNames) {
          const setting = await DiffPanel.stateStorage?.getConnectionSettingByName(conName);
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
                afterList[i] = afterRdh;
              }
            }
          );

          if (!ok) {
            window.showErrorMessage(message);
          }
        }
        progress.report({ increment: 100 });
      }
    );

    const diffParams: DiffTabParam = {
      title: tabItem.title,
      list1: beforeList,
      list2: afterList.map((it) => it!),
    };
    if (afterList.some((it) => it === undefined)) {
      return;
    }
    await this.renderSub(diffParams);
  }
}
