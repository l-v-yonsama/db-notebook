import { prettyFileSize, prettyTime } from "@l-v-yonsama/multi-platform-database-drivers";
import { createRdhKey, GeneralColumnType, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { createHash } from "crypto";
import * as dayjs from "dayjs";
import type { Har } from "har-format";
import * as path from "path";
import * as vscode from "vscode";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { ActionCommand, OutputParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { HarFilePanelEventData, HarFileTabItem } from "../shared/MessageEventData";
import { hideStatusMessage } from "../statusBar";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { getIconPath, readResource } from "../utilities/fsUtil";
import { createHtmlFromHarItem } from "../utilities/htmlGenerator";
import { toNodeRunAxiosEvent } from "../utilities/httpUtil";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";
import { HttpEventPanel } from "./HttpEventPanel";

const PREFIX = "[HarFilePanel]";

export class HarFilePanel extends BasePanel {
  public static currentPanel: HarFilePanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private items: HarFileTabItem[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    HarFilePanel.currentPanel = new HarFilePanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    HarFilePanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, harUri: Uri) {
    if (HarFilePanel.currentPanel) {
      HarFilePanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel("HarFileType", "HarFile", ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          Uri.joinPath(extensionUri, "out"),
          Uri.joinPath(extensionUri, "webview-ui/build"),
        ],
      });
      panel.iconPath = getIconPath("output.svg");
      HarFilePanel.currentPanel = new HarFilePanel(panel, extensionUri);
    }
    // vscode.window.activeColorTheme.kind===ColorThemeKind.Dark
    HarFilePanel.currentPanel.renderSub(harUri);
  }

  getComponentName(): ComponentName {
    return "HarFilePanel";
  }

  private createTabItem(title: string, res: Har): HarFileTabItem {
    const type = GeneralColumnType.TEXT;
    const meta = { disabledDetailPane: true };

    const rdb = new ResultSetDataBuilder([
      createRdhKey({ name: "url", type, width: 500, align: "left" }),
      createRdhKey({ name: "status", type: GeneralColumnType.INTEGER, width: 60 }),
      createRdhKey({ name: "method", type, width: 60, meta }),
      createRdhKey({ name: "contentType", type, width: 100, meta }),
      createRdhKey({ name: "size", type, width: 60, align: "right", meta }),
      createRdhKey({ name: "time", type, width: 60, align: "right", meta }),
    ]);

    res.log.entries.forEach((entry) => {
      const { url, method } = entry.request;
      const { status } = entry.response;
      rdb.addRow({
        url,
        status,
        method,
        contentType: entry.response.content.mimeType,
        size: prettyFileSize(entry.response.content.size),
        time: prettyTime(Math.round(entry.time)),
      });
    });
    const tabId = createHash("md5").update(title).digest("hex");
    const item: HarFileTabItem = {
      tabId,
      title,
      res,
      rdh: rdb.build(),
    };
    return item;
  }

  private getTabByTitle(title: string): HarFileTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }

  async renderSub(harUri: Uri): Promise<HarFileTabItem | undefined> {
    const title = harUri.fsPath;
    const res = JSON.parse(await readResource(harUri));

    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      const tmp = this.createTabItem(title, res);
      item.res = tmp.res;
      item.rdh = tmp.rdh;
      const msg: HarFilePanelEventData = {
        command: "set-response",
        componentName: "HarFilePanel",
        value: {
          searchResponse: {
            tabId: item.tabId,
            value: {
              res: tmp.res,
              rdh: tmp.rdh,
            },
          },
        },
      };
      this.panel.webview.postMessage(msg);
      return item;
    }

    item = this.createTabItem(title, res);
    this.items.push(item);

    const msg2: HarFilePanelEventData = {
      command: "add-tab-item",
      componentName: "HarFilePanel",
      value: {
        addTabItem: item,
      },
    };
    this.panel.webview.postMessage(msg2);
    return item;
  }

  public preDispose(): void {
    HarFilePanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
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

          const entry = tabItem.res.log.entries[innerIndex];
          const axiosEvent = toNodeRunAxiosEvent(entry);

          HttpEventPanel.render(this.extensionUri, axiosEvent.title, axiosEvent);
        }
        break;
      case "output":
        this.output(params);
        return;
    }
  }

  private getTabItemById(tabId: string): HarFileTabItem | undefined {
    return this.items.find((it) => it.tabId === tabId);
  }

  private async output(data: OutputParams) {
    const { tabId } = data;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const { title, res, rdh } = tabItem;
    const fileExtension = "html";
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${title}.${fileExtension}`;
    const previousFolder = await HarFilePanel.stateStorage?.getPreviousSaveFolder();
    const baseUri = previousFolder ? Uri.file(previousFolder) : Uri.file("./");
    const uri = await window.showSaveDialog({
      defaultUri: Uri.joinPath(baseUri, defaultFileName),
      filters: { "*": [fileExtension] },
    });
    if (!uri) {
      return;
    }
    await HarFilePanel.stateStorage?.setPreviousSaveFolder(path.dirname(uri.fsPath));
    const message = await createHtmlFromHarItem({ title, res, rdh }, uri.fsPath);
    if (message) {
      showWindowErrorMessage(message);
    } else {
      window.setStatusBarMessage(uri.fsPath, 3000);
    }
  }
}
