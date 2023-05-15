import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn, commands } from "vscode";
import {
  DBDriverResolver,
  DiffResult,
  RDSBaseDriver,
  ResultSetDataHolder,
  diff,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ToWebviewMessageEventType } from "../types/ToWebviewMessageEvent";
import { StateStorage } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { ActionCommand, CompareParams, OutputParams, TabIdParam } from "../shared/ActionParams";
import { createWebviewContent } from "../utilities/webviewUtil";
import { createBookFromDiffList } from "../utilities/excelGenerator";

dayjs.extend(utc);

const componentName = "DiffPanel";

type DiffTabInnerItem = {
  tabId: string;
  title: string;
  rdh1: ResultSetDataHolder;
  rdh2: ResultSetDataHolder;
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
  list1: ResultSetDataHolder[];
  list2: ResultSetDataHolder[];
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
    console.log("at DiffPanel.vue called render", params);
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

  private createTabItem(
    title: string,
    list1: ResultSetDataHolder[],
    list2: ResultSetDataHolder[]
  ): DiffTabItem {
    let subTitle = "";
    if (list1.length) {
      let before = dayjs(list1[0].created).format("HH:mm");
      let after = dayjs(list2[0].created).format("HH:mm");
      if (before === after) {
        before = dayjs(list1[0].created).format("HH:mm:ss");
        after = dayjs(list2[0].created).format("HH:mm:ss");
      }
      subTitle = `${before} ⇔ ${after}`;
    }
    list1.forEach((it) => it.clearAllAnotations());
    list2.forEach((it) => it.clearAllAnotations());

    const createTabId = () => createHash("md5").update(title).digest("hex");
    const tabId = createTabId();
    const item: DiffTabItem = {
      tabId,
      title,
      subTitle,
      list: list1.map((rdh1, idx) => {
        const rdh2 = list2[idx];
        const diffResult = diff(rdh1, rdh2);
        return {
          tabId: createTabId(),
          title: rdh1.meta.tableName ?? "",
          diffResult,
          rdh1,
          rdh2,
        } as DiffTabInnerItem;
      }),
    };
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
      const tmpItem = this.createTabItem("tmp", list1, list2);
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

    item = this.createTabItem(title, list1, list2);
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

        console.log("⭐️received message from webview ", message);
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
          // case "refresh":
          //   this.refresh(params);
          //   return;
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
      outputWithType: data.outputWithType,
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
    const beforeList = baseList.map((it) => ResultSetDataHolder.from(it));
    const afterList = baseList.map((it) => undefined as ResultSetDataHolder | undefined);
    for (const conName of conNames) {
      const setting = await DiffPanel.stateStorage?.getConnectionSettingByName(conName);
      if (!setting) {
        continue;
      }

      const driver = DBDriverResolver.getInstance().createDriver<RDSBaseDriver>(setting);
      const { ok, message } = await driver.flow(async () => {
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
        DBDriverResolver.getInstance().removeDriver(driver);
      });
      if (!ok) {
        window.showErrorMessage(message);
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
    this.renderSub(diffParams);
  }
}
