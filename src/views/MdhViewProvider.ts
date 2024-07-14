import {
  DBDriverResolver,
  RDSBaseDriver,
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { resolveCodeLabel, ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { createHash } from "crypto";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import { commands, env, ExtensionContext, ProgressLocation, Uri, window } from "vscode";
import { BOTTOM_MDH_VIEWID, OPEN_DIFF_MDH_VIEWER, OPEN_MDH_VIEWER } from "../constant";
import {
  ActionCommand,
  CompareParams,
  OutputParams,
  WriteToClipboardParams,
} from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { MdhViewEventData, RdhTabItem } from "../shared/MessageEventData";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { DiffMdhViewTabParam, MdhViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { createBookFromList } from "../utilities/excelGenerator";
import { createHtmlFromRdhList } from "../utilities/htmlGenerator";
import { rdhListToText } from "../utilities/rdhToText";
import { StateStorage } from "../utilities/StateStorage";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";
import path = require("path");

const PREFIX = "[MdhView]";
dayjs.extend(utc);

export class MdhViewProvider extends BaseViewProvider {
  private currentTabId?: string;
  private currentInnerIndex?: number;
  private items: RdhTabItem[] = [];

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "MdhView";
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
            this.webviewView = undefined;
            this.currentTabId = undefined;
            this.currentInnerIndex = undefined;
            await commands.executeCommand("setContext", BOTTOM_MDH_VIEWID + ".visible", false);
          }
          // currentXXXの再設定はフロントから受けるselectTab,selectInnerTabのリクエストのタイミングで実施
        }
        break;
      case "selectTab":
        {
          const { tabId } = params;
          this.currentTabId = tabId;
          this.currentInnerIndex = undefined;
          hideStatusMessage();
        }
        break;
      case "describe":
        {
          const { tabId, innerIndex } = params;
          const tabItem = this.getTabItemById(tabId);
          if (!tabItem) {
            return;
          }
          const rdh = tabItem.list[innerIndex];
          const ss = ResultSetDataBuilder.from(rdh).describe();

          const commandParam: MdhViewParams = { title: "Statistics", list: [ss] };
          commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
        }
        break;
      case "selectInnerTab":
        {
          const { tabId, innerIndex } = params;
          const tabItem = this.getTabItemById(tabId);
          if (!tabItem) {
            return;
          }
          this.currentTabId = tabId;
          this.currentInnerIndex = innerIndex;

          const info = tabItem.list[innerIndex].summary?.info ?? "";
          showStatusMessage(info);
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

          this.postMessage<MdhViewEventData>({
            command: "set-search-result",
            componentName: "MdhView",
            value: {
              searchResult: {
                tabId,
                value: tabItem.list,
              },
            },
          });
        }
        return;
      case "output":
        this.output(params);
        return;
      case "showError":
        await showWindowErrorMessage(params.message);
        return;
      case "writeToClipboard":
        this.writeToClipboard(params);
        return;
    }
  }

  async render({ title, list }: MdhViewParams) {
    if (this.webviewView === undefined) {
      await commands.executeCommand("setContext", BOTTOM_MDH_VIEWID + ".visible", true);
    }

    await commands.executeCommand(BOTTOM_MDH_VIEWID + ".focus", { preserveFocus: true });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.renderSub(
      title,
      list.map((it) => ResultSetDataBuilder.from(it).build())
    );
  }

  protected onDidChangeVisibility(visible: boolean): void {
    if (visible === true && this.currentTabId) {
      this.postMessage<MdhViewEventData>({
        command: "init",
        componentName: "MdhView",

        value: {
          init: {
            tabItems: this.items,
            currentTabId: this.currentTabId,
            currentInnerIndex: this.currentInnerIndex,
          },
        },
      });
    }
  }

  private getTabByTitle(title: string): RdhTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }

  private getTabItemById(tabId: string): RdhTabItem | undefined {
    return this.items.find((it) => it.tabId === tabId);
  }

  private async renderSub(title: string, list: ResultSetData[]): Promise<RdhTabItem | undefined> {
    this.currentInnerIndex = undefined;
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      item.list = list;

      this.postMessage<MdhViewEventData>({
        command: "set-search-result",
        componentName: "MdhView",

        value: {
          searchResult: {
            tabId: item.tabId,
            value: item.list,
          },
        },
      });
      this.currentTabId = item.tabId;
      return item;
    }

    item = this.createTabItem(title, list);
    this.items.push(item);
    this.currentTabId = item.tabId;

    this.postMessage<MdhViewEventData>({
      command: "add-tab-item",
      componentName: "MdhView",
      value: {
        addTabItem: item,
      },
    });
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

  private async output(data: OutputParams) {
    const { tabId } = data;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const { title } = tabItem;
    const fileExtension = data.fileType === "excel" ? "xlsx" : "html";
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${title}.${fileExtension}`;
    const uri = await window.showSaveDialog({
      defaultUri: Uri.file(path.join("./", defaultFileName)),
      filters: { "*": [fileExtension] },
    });
    if (!uri) {
      return;
    }
    const message =
      data.fileType === "excel"
        ? await createBookFromList(tabItem.list, uri.fsPath, {
            rdh: {
              outputAllOnOneSheet: true,
            },
            rule: {
              withRecordRule: true,
            },
          })
        : await createHtmlFromRdhList(tabItem.list, uri.fsPath);
    if (message) {
      showWindowErrorMessage(message);
    } else {
      window.showInformationMessage(uri.fsPath);
    }
  }

  private async writeToClipboard(params: WriteToClipboardParams) {
    const { tabId } = params;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }

    await env.clipboard.writeText(rdhListToText(tabItem.list, params));
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
        location: ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        for (const conName of conNames) {
          const setting = await this.stateStorage?.getConnectionSettingByName(conName);
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
            showWindowErrorMessage(message);
          }
        }

        progress.report({
          increment: 100,
        });
      }
    );
    const diffParams: DiffMdhViewTabParam = {
      title: tabItem.title,
      comparable: true,
      undoable: true,
      list1: beforeList,
      list2: afterList.map((it) => it!),
    };
    if (afterList.some((it) => it === undefined)) {
      return;
    }
    commands.executeCommand(OPEN_DIFF_MDH_VIEWER, diffParams);
  }

  private async refresh({ tabId }: { tabId: string }) {
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const { list } = tabItem;
    const conNames = [...new Set(list.map((it) => it.meta.connectionName + ""))];
    for (const conName of conNames) {
      const setting = await this.stateStorage?.getConnectionSettingByName(conName);
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
        showWindowErrorMessage(message);
      }
    }

    this.postMessage<MdhViewEventData>({
      command: "set-search-result",
      componentName: "MdhView",
      value: {
        searchResult: {
          tabId,
          value: tabItem.list,
        },
      },
    });
  }
}
