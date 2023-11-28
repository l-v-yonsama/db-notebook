import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import * as path from "path";
import {
  AwsDriver,
  DBDriverResolver,
  DBType,
  DbLogStream,
  DbResource,
  RedisDriver,
  ResourceType,
  ResultSetData,
  ScanParams,
} from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { createBookFromRdh } from "../utilities/excelGenerator";
import { StateStorage } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import { createHash } from "crypto";
import { ActionCommand, SearchScanPanelParams } from "../shared/ActionParams";
import { OutputParams } from "../shared/ActionParams";
import { createWebviewContent } from "../utilities/webviewUtil";
import { log } from "../utilities/logger";
import { ScanPanelEventData, ScanTabItem, ScanConditionItem } from "../shared/MessageEventData";
import { ComponentName } from "../shared/ComponentName";

const PREFIX = "[ScanPanel]";

dayjs.extend(utc);

export const componentName: ComponentName = "ScanPanel";

export class ScanPanel {
  public static currentPanel: ScanPanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private items: ScanTabItem[] = [];
  private activeTitle = "";

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(
      this._panel.webview,
      extensionUri,
      componentName
    );
    this._setWebviewMessageListener(this._panel.webview);
  }

  static setStateStorage(storage: StateStorage) {
    ScanPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, rootRes: DbResource) {
    if (rootRes === null || rootRes === undefined) {
      throw new Error("rootRes must be defined");
    }
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
    ctor?: (item: ScanTabItem) => void
  ): ScanTabItem {
    const createCondition = (label: string, value: any): ScanConditionItem => ({
      label,
      value,
      visible: true,
    });

    const now = dayjs();
    const title = rootRes.name;
    const keyword = createCondition("Keyword", "");
    const limit = createCondition("Limit", 1000);
    const startDt = createCondition("StartDt", now.format("YYYY-MM-DD"));
    const endDt = createCondition("EndDt", now.format("YYYY-MM-DD"));
    const resourceType = createCondition("resourceType", rootRes.resourceType);
    let parentTarget: string | undefined = undefined;
    let targetName = rootRes.name;

    let multilineKeyword = false;

    startDt.visible = false;
    endDt.visible = false;
    resourceType.visible = false;

    switch (dbType) {
      case DBType.Redis:
        keyword.value = "*";
        break;
      case DBType.Auth0:
        resourceType.visible = true;
        switch (rootRes.resourceType) {
          case "Auth0Database":
            resourceType.value = "IamOrganization";
            resourceType.items = [
              ResourceType.IamClient,
              ResourceType.IamOrganization,
              ResourceType.IamRole,
              ResourceType.IamUser,
            ].map((it) => ({
              label: it.substring(3),
              value: it,
            }));
            break;
          case "IamOrganization":
            parentTarget = rootRes.id;
            targetName = "";
            resourceType.value = "IamUser";
            resourceType.items = [ResourceType.IamUser].map((it) => ({
              label: it.substring(3),
              value: it,
            }));
            break;
        }
        break;
      case DBType.Keycloak:
        resourceType.visible = true;
        switch (rootRes.resourceType) {
          case "IamRealm":
            resourceType.value = "IamGroup";
            resourceType.items = [
              ResourceType.IamRealm,
              ResourceType.IamGroup,
              ResourceType.IamRole,
              ResourceType.IamUser,
            ].map((it) => ({
              label: it.substring(3),
              value: it,
            }));
            break;
          case "IamGroup":
            parentTarget = rootRes.id;
            targetName = rootRes.meta.realmName;
            resourceType.value = "IamUser";
            resourceType.items = [ResourceType.IamUser].map((it) => ({
              label: it.substring(3),
              value: it,
            }));
            break;
        }
        break;
      case DBType.Aws:
        switch (rootRes.resourceType) {
          case "Bucket":
            keyword.label = "Prefix";
            keyword.value = "";
            startDt.label = "lastModified";
            startDt.visible = true;
            endDt.label = "〜";
            endDt.visible = true;
            break;
          case "Queue":
            keyword.label = "Keyword";
            keyword.value = "";
            limit.value = 10;
            break;
          case "LogGroup":
            multilineKeyword = true;
            startDt.visible = true;
            endDt.visible = true;
            limit.value = 100;
            keyword.label = "Query";
            keyword.value =
              "fields @timestamp, @message, @logStream\n|  filter @message like /(?i)(exception|error)/ \n| sort @timestamp desc\n";
            break;
          case "LogStream":
            startDt.visible = true;
            limit.value = 1000;
            keyword.label = "Highlight";
            break;
        }
        break;
    }

    const item = {
      parentTarget,
      targetName,
      tabId: rootRes.id,
      conName,
      resourceType,
      title,
      dbType,
      rootRes,
      keyword,
      limit,
      startDt,
      endDt,
      multilineKeyword,
    };
    if (ctor) {
      ctor(item);
    }
    return item;
  }

  private getTabItem(res: DbResource): ScanTabItem | undefined {
    return this.items.find((it) => it.tabId === res.id);
  }

  async renderSub(
    rootRes: DbResource,
    ctor?: (item: ScanTabItem) => void
  ): Promise<ScanTabItem | undefined> {
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

    const msg2: ScanPanelEventData = {
      command: "add-tab-item",
      componentName: "ScanPanel",
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

  /**
   * スキャンする
   */
  private async search(data: SearchScanPanelParams) {
    log(`${PREFIX} search(${JSON.stringify(data)})`);
    const { tabId, keyword, limit, startTime, endTime, resourceType } = data;
    const panelItem = this.items.find((it) => it.tabId === tabId);
    if (!panelItem) {
      return;
    }
    panelItem.lastSearchParam = data;
    const setting = await ScanPanel.stateStorage?.getConnectionSettingByName(panelItem.conName);
    if (!setting) {
      return;
    }
    const { rootRes, parentTarget, targetName } = panelItem;

    resourceType;

    const targetResourceType = resourceType;

    const { ok, message, result } = await DBDriverResolver.getInstance().workflow(
      setting,
      async (driver) => {
        let scannable: any = driver;
        if (driver instanceof AwsDriver) {
          const awsDriver = driver as AwsDriver;
          scannable = awsDriver.getClientByResourceType(targetResourceType);
        }

        var input: ScanParams = {
          targetResourceType,
          parentTarget,
          target: targetName ?? "",
          keyword: keyword,
          limit: limit ?? 100,
          startTime: startTime ? dayjs(startTime).valueOf() : undefined,
          endTime: endTime ? dayjs(endTime).valueOf() : undefined,
          withValue: {
            limitSize: 100_000,
          },
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

      const msg: ScanPanelEventData = {
        command: "set-search-result",
        componentName: "ScanPanel",
        value: {
          searchResult: {
            tabId,
            value: rdh,
          },
        },
      };
      this._panel.webview.postMessage(msg);
    } else {
      vscode.window.showErrorMessage(message);
      const msg2: ScanPanelEventData = {
        command: "stop-progress",
        componentName: "ScanPanel",
        value: {},
      };
      this._panel.webview.postMessage(msg2);
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

    const msg: ScanPanelEventData = {
      command: "remove-tab-item",
      componentName: "ScanPanel",
      value: {
        removeTabItem: {
          tabId: newResId,
        },
      },
    };
    console.log(msg);
    this._panel.webview.postMessage(msg);

    setTimeout(async () => {
      res.meta = {
        conName: parentItem?.conName,
      };

      panelItem = await this.renderSub(res, (item) => {
        item.startDt.value = dayjs(startTime).format("YYYY-MM-DD"); //  for input type datetime-local
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
        resourceType: "LogStream",
      });
    }, 100);
  }
}
