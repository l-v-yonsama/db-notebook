import {
  AwsDriver,
  DBDriverResolver,
  DBType,
  DbLogStream,
  DbResource,
  RedisDriver,
  ResourceType,
  ScanParams,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { createHash } from "crypto";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";
import * as vscode from "vscode";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { OPEN_DIFF_MDH_VIEWER } from "../constant";
import { ActionCommand, OutputParams, SearchScanPanelParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { ScanConditionItem, ScanPanelEventData, ScanTabItem } from "../shared/MessageEventData";
import { DiffMdhViewTabParam } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { getDatabaseConfig } from "../utilities/configUtil";
import { createBookFromRdh } from "../utilities/excelGenerator";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[ScanPanel]";

dayjs.extend(utc);

export class ScanPanel extends BasePanel {
  public static currentPanel: ScanPanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private items: ScanTabItem[] = [];
  private activeTitle = "";

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    ScanPanel.currentPanel = new ScanPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    ScanPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, rootRes: DbResource) {
    if (rootRes === null || rootRes === undefined) {
      throw new Error("rootRes must be defined");
    }
    if (ScanPanel.currentPanel) {
      ScanPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
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

  getComponentName(): ComponentName {
    return "ScanPanel";
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
    const limit = createCondition("Limit", getDatabaseConfig().limitRows);
    const jsonExpansion = createCondition("JsonExpansion", false);
    const startDt = createCondition("StartDt", now.format("YYYY-MM-DD"));
    const endDt = createCondition("EndDt", now.format("YYYY-MM-DD"));
    const resourceType = createCondition("resourceType", rootRes.resourceType);
    let parentTarget: string | undefined = undefined;
    let targetName = rootRes.name;

    let multilineKeyword = false;

    startDt.visible = false;
    endDt.visible = false;
    resourceType.visible = false;
    jsonExpansion.visible = false;

    switch (dbType) {
      case DBType.Redis:
        keyword.value = "*";
        break;
      case DBType.Auth0:
        resourceType.visible = true;
        jsonExpansion.visible = true;
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
        jsonExpansion.visible = true;
        switch (rootRes.resourceType) {
          case "IamRealm":
            resourceType.value = "IamGroup";
            resourceType.items = [
              ResourceType.IamRealm,
              ResourceType.IamGroup,
              ResourceType.IamRole,
              ResourceType.IamUser,
              ResourceType.IamSession,
            ].map((it) => ({
              label: it.substring(3),
              value: it,
            }));
            break;
          case "IamClient":
            parentTarget = rootRes.id; // clientUUID: parentTarget
            targetName = rootRes.meta.realmName;
            resourceType.value = "IamSession";
            resourceType.items = [ResourceType.IamSession].map((it) => ({
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
      jsonExpansion,
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
    this.panel.webview.postMessage(msg2);
    return item;
  }

  public preDispose(): void {
    ScanPanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
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
      showWindowErrorMessage(message);
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
    const previousFolder = await ScanPanel.stateStorage?.getPreviousSaveFolder();
    const baseUri = previousFolder ? Uri.file(previousFolder) : Uri.file("./");
    const uri = await vscode.window.showSaveDialog({
      defaultUri: Uri.joinPath(baseUri, defaultFileName),
      filters: { "*": ["xlsx"] },
    });
    if (!uri) {
      return;
    }
    await ScanPanel.stateStorage?.setPreviousSaveFolder(path.dirname(uri.fsPath));
    const message = await createBookFromRdh(rdh, uri.fsPath);
    if (message) {
      showWindowErrorMessage(message);
    } else {
      vscode.window.showInformationMessage(uri.fsPath);
    }
  }

  /**
   * スキャンする
   */
  private async search(data: SearchScanPanelParams) {
    log(`${PREFIX} search(${JSON.stringify(data)})`);
    const {
      tabId,
      keyword,
      limit,
      jsonExpansion,
      startTime,
      endTime,
      resourceType,
      execComparativeProcess,
    } = data;
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
          jsonExpansion,
          startTime: this.getEpochTimeInSec(startTime),
          endTime: this.getEpochTimeInSec(endTime),
          withValue: {
            limitSize: 100_000,
          },
        };

        log(`${PREFIX} search(${JSON.stringify(input)})`);
        return await scannable.scan(input);
      }
    );

    if (ok && result) {
      const rdh = result as ResultSetData;
      let prevRdh = panelItem.rdh;
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
            resourceType: targetResourceType,
          },
        },
      };
      this.panel.webview.postMessage(msg);

      if (
        execComparativeProcess &&
        prevRdh &&
        panelItem.prevResourceTypeValue === targetResourceType
      ) {
        await this.compare(targetResourceType, prevRdh, rdh);
      }
      panelItem.prevResourceTypeValue = targetResourceType;
    } else {
      showWindowErrorMessage(message);
      const msg2: ScanPanelEventData = {
        command: "stop-progress",
        componentName: "ScanPanel",
        value: {},
      };
      this.panel.webview.postMessage(msg2);
    }
  }

  private async compare(title: string, rdh1: ResultSetData, rdh2: ResultSetData) {
    const beforeList = [ResultSetDataBuilder.from(rdh1).build()];
    const afterList = [ResultSetDataBuilder.from(rdh2).build()];

    const diffParams: DiffMdhViewTabParam = {
      title,
      comparable: false,
      undoable: false,
      list1: beforeList,
      list2: afterList.map((it) => it!),
    };
    if (afterList.some((it) => it === undefined)) {
      return;
    }
    vscode.commands.executeCommand(OPEN_DIFF_MDH_VIEWER, diffParams);
  }

  private getEpochTimeInSec(dt: any): number | undefined {
    if (dt === undefined || dt === null) {
      return undefined;
    }
    return Math.round(dayjs(dt).valueOf() / 1000);
  }

  private async openLogStreamScanPanel(data: any) {
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

    this.panel.webview.postMessage(msg);

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
