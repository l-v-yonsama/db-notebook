import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import * as path from "path";
import {
  AwsDriver,
  DBDriverResolver,
  DBType,
  DbLogStream,
  DbResource,
  RedisDriver,
  ResultSetData,
} from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { createBookFromRdh } from "../utilities/excelGenerator";
import { ToWebviewMessageEventType } from "../types/ToWebviewMessageEvent";
import { StateStorage } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import { createHash } from "crypto";
import { ActionCommand } from "../shared/ActionParams";
import { OutputParams } from "../shared/ActionParams";
import { createWebviewContent } from "../utilities/webviewUtil";

dayjs.extend(utc);

export const componentName = "ScanPanel";

type ConditionItem = {
  label: string;
  value: any;
  visible: boolean;
  description?: string;
};

type TabItem = {
  tabId: string;
  conName: string;
  rootRes: DbResource;
  title: string;
  dbType: DBType;
  rdh?: any;
  limit: ConditionItem;
  keyword: ConditionItem;
  startTime: ConditionItem;
  endTime: ConditionItem;
  multilineKeyword: boolean;
  parentTarget?: string;
  lastSearchParam?: ScanReqInput;
};

type ScanReqInput = {
  tabId: string;
  keyword: string;
  limit?: number;
  startTime?: any;
  endTime?: any;
};

export class ScanPanel {
  public static currentPanel: ScanPanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private items: TabItem[] = [];
  private activeTitle = "";

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(this._panel.webview, extensionUri);
    this._setWebviewMessageListener(this._panel.webview);
  }

  static setStateStorage(storage: StateStorage) {
    ScanPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, rootRes: DbResource) {
    if (ScanPanel.currentPanel) {
      // If the webview panel already exists reveal it
      ScanPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "ScanPanelViewType",
        "Scan resources",
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
      ScanPanel.currentPanel = new ScanPanel(panel, extensionUri);
    }
    ScanPanel.currentPanel.renderSub(rootRes);
  }

  private createTabItem(
    conName: string,
    dbType: DBType,
    rootRes: DbResource,
    ctor?: (item: TabItem) => void
  ): TabItem {
    const createCondition = (label: string, value: any): ConditionItem => ({
      label,
      value,
      visible: true,
    });

    const now = dayjs();
    const title = rootRes.name;
    const keyword = createCondition("Keyword", "");
    const limit = createCondition("Limit", 1000);
    const startTime = createCondition(
      "StartTime",
      now.add(-2, "hour").format("YYYY-MM-DDTHH:mm:ss")
    );
    const endTime = createCondition("EndTime", now.format("YYYY-MM-DDTHH:mm:ss"));
    let multilineKeyword = false;

    startTime.visible = false;
    endTime.visible = false;
    switch (dbType) {
      case DBType.Redis:
        keyword.value = "*";
        break;
      case DBType.Aws:
        switch (rootRes.resourceType) {
          case "Bucket":
            keyword.label = "Prefix";
            keyword.value = "";
            break;
          case "Queue":
            keyword.label = "Keyword";
            keyword.value = "";
            break;
          case "LogGroup":
            multilineKeyword = true;
            startTime.visible = true;
            endTime.visible = true;
            limit.value = 100;
            keyword.label = "Query";
            keyword.value =
              "fields @timestamp, @message, @logStream\n|  filter @message like /(?i)(exception|error)/ \n| sort @timestamp desc\n";
            break;
          case "LogStream":
            startTime.visible = true;
            limit.value = 1000;
            keyword.label = "Highlight";
            break;
        }
        break;
    }

    const item = {
      tabId: rootRes.id,
      conName,
      title,
      dbType,
      rootRes,
      keyword,
      limit,
      startTime,
      endTime,
      multilineKeyword,
    };
    if (ctor) {
      ctor(item);
    }
    return item;
  }

  private getTabItem(res: DbResource): TabItem | undefined {
    return this.items.find((it) => it.tabId === res.id);
  }

  async renderSub(
    rootRes: DbResource,
    ctor?: (item: TabItem) => void
  ): Promise<TabItem | undefined> {
    const { conName } = rootRes.meta;
    const setting = await ScanPanel.stateStorage?.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }
    const title = rootRes.name;
    let item = this.getTabItem(rootRes);
    if (!item) {
      item = this.createTabItem(conName, setting.dbType, rootRes, ctor);
      this.items.push(item);
    }
    this.activeTitle = title;

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
    ScanPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  /**
   * Sets up an event listener to listen for messages passed from the webview context and
   * executes code based on the message that is recieved.
   *
   * @param webview A reference to the extension webview
   * @param context A reference to the extension context
   */
  private _setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      async (message: ActionCommand) => {
        const { command, params } = message;

        switch (command) {
          case "closeScanPanel":
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
          case "search":
            this.search(params);
            return;
          case "output":
            this.output(params);
            return;
          case "openScanPanel":
            this.openLogStreamScanPanel(params);
            return;
          case "DeleteKey":
            this.deleteKey(params);
            return;
        }
      },
      undefined,
      this._disposables
    );
  }

  private async deleteKey({ tabId, key }: { tabId: string; key: string }) {
    const tabItem = this.items.find((it) => it.tabId === tabId);
    if (!tabItem) {
      return;
    }
    const setting = await ScanPanel.stateStorage?.getConnectionSettingByName(tabItem.conName);
    if (!setting) {
      return;
    }
    const answer = await window.showInformationMessage(
      `Are you sure to delete key:'${key}'?`,
      "YES",
      "NO"
    );
    if (answer !== "YES") {
      return;
    }

    const { ok, message } = await DBDriverResolver.getInstance().workflow(
      setting,
      async (driver) => {
        if (driver instanceof RedisDriver) {
          const redisDriver = driver as RedisDriver;
          await redisDriver.delete(key);
        }
      }
    );

    if (ok) {
      if (tabItem.lastSearchParam) {
        this.search(tabItem.lastSearchParam);
      }
    } else {
      vscode.window.showErrorMessage(message);
    }
  }

  private async output(data: OutputParams) {
    const { tabId } = data;
    const tabItem = this.items.find((it) => it.tabId === tabId);
    if (!tabItem) {
      return;
    }
    const { rdh } = tabItem;
    const tableName = rdh.meta?.tableName;
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${tableName ?? "rdh"}.xlsx`;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: Uri.file(path.join("./", defaultFileName)),
      filters: { "*": ["xlsx"] },
    });
    if (!uri) {
      return;
    }
    const message = await createBookFromRdh(rdh, uri.fsPath);
    if (message) {
      vscode.window.showErrorMessage(message);
    } else {
      vscode.window.showInformationMessage(uri.fsPath);
    }
  }

  private async search(data: ScanReqInput) {
    const { tabId, keyword, limit, startTime, endTime } = data;
    const panelItem = this.items.find((it) => it.tabId === tabId);
    if (!panelItem) {
      return;
    }
    panelItem.lastSearchParam = data;
    const setting = await ScanPanel.stateStorage?.getConnectionSettingByName(panelItem.conName);
    if (!setting) {
      return;
    }
    const { rootRes, parentTarget } = panelItem;

    const { ok, message, result } = await DBDriverResolver.getInstance().workflow(
      setting,
      async (driver) => {
        let scannable: any = driver;
        if (driver instanceof AwsDriver) {
          const awsDriver = driver as AwsDriver;
          scannable = awsDriver.getClientByResourceType(rootRes.resourceType);
        }

        var input = {
          targetResourceType: rootRes.resourceType,
          parentTarget,
          target: rootRes?.name ?? "",
          keyword: keyword,
          limit,
          startTime: startTime ? dayjs(startTime).valueOf() : undefined,
          endTime: endTime ? dayjs(endTime).valueOf() : undefined,
          withValue: "auto",
        };

        return await scannable.scan(input);
      }
    );

    if (ok && result) {
      const rdh = result as ResultSetData;
      panelItem.rdh = rdh;
      if (!rdh.meta?.tableName) {
        rdh.meta.tableName = rootRes.name;
      }

      const msg: ToWebviewMessageEventType = {
        command: componentName + "-set-search-result",
        value: {
          tabId,
          value: rdh,
        },
      };
      this._panel.webview.postMessage(msg);
    } else {
      vscode.window.showErrorMessage(message);
    }
  }

  private async openLogStreamScanPanel(data: any) {
    console.log("🔸ScanPanel L315:called openLogStreamScanPanel", data);
    const { parentTabId, logStream, startTime } = data;
    const parentItem = this.items.find((it) => it.tabId === parentTabId);

    const title = logStream;
    const res = new DbLogStream(logStream, {} as any);
    const hashTitle = `${parentItem?.title}-${title}`;
    const newResId = createHash("md5").update(hashTitle).digest("hex");

    let panelItem = this.items.find((it) => it.tabId === newResId);

    const msg: ToWebviewMessageEventType = {
      command: componentName + "-remove-tab-item",
      value: {
        tabId: newResId,
      },
    };
    console.log(msg);
    this._panel.webview.postMessage(msg);

    setTimeout(async () => {
      res.meta = {
        conName: parentItem?.conName,
      };

      panelItem = await this.renderSub(res, (item) => {
        item.startTime.value = dayjs(startTime).format("YYYY-MM-DDTHH:mm:ss"); //  for input type datetime-local
      });
      if (!panelItem) {
        return;
      }
      panelItem.parentTarget = parentItem?.rootRes.name;

      const setting = ScanPanel.stateStorage?.getConnectionSettingByName(panelItem.conName);
      if (!setting) {
        return;
      }
      await this.search({
        tabId: panelItem.tabId,
        limit: 1000,
        keyword: "",
        startTime,
      });
    }, 100);
  }
}
