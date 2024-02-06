import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn, ThemeIcon } from "vscode";
import * as vscode from "vscode";

import { createHash } from "crypto";
import { ActionCommand } from "../shared/ActionParams";
import { log, logError } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { ComponentName } from "../shared/ComponentName";
import { HarFilePanelEventData, HarFileTabItem } from "../shared/MessageEventData";
import { getIconPath, readResource } from "../utilities/fsUtil";
import type { Har } from "har-format";
import {
  GeneralColumnType,
  ResultSetDataBuilder,
  abbr,
  createRdhKey,
  prettyFileSize,
  prettyTime,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { HttpEventPanel } from "./HttpEventPanel";
import { toNodeRunAxiosEvent } from "../utilities/httpUtil";

const PREFIX = "[HarFilePanel]";

const componentName: ComponentName = "HarFilePanel";

export class HarFilePanel {
  public static currentPanel: HarFilePanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private items: HarFileTabItem[] = [];

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
    HarFilePanel.currentPanel = new HarFilePanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, harUri: Uri) {
    if (HarFilePanel.currentPanel) {
      HarFilePanel.currentPanel._panel.reveal(ViewColumn.One);
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
      this._panel.webview.postMessage(msg);
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
    this._panel.webview.postMessage(msg2);
    return item;
  }

  public dispose() {
    log(`${PREFIX} dispose`);

    HarFilePanel.currentPanel = undefined;
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

              const entry = tabItem.res.log.entries[innerIndex];
              const axiosEvent = toNodeRunAxiosEvent(entry);

              HttpEventPanel.render(this.extensionUri, axiosEvent.title, axiosEvent);
            }
            break;
        }
      },
      undefined,
      this._disposables
    );
  }

  private getTabItemById(tabId: string): HarFileTabItem | undefined {
    return this.items.find((it) => it.tabId === tabId);
  }
}
