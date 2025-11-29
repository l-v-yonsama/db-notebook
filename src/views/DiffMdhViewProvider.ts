import {
  createUndoChangeSQL,
  DBDriverResolver,
  DBType,
  RDSBaseDriver,
  runRuleEngine,
  SQLLang,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  asyncDiff,
  diffToUndoChanges,
  RdhHelper,
  resolveCodeLabel,
  ResultSetData,
  ResultSetDataBuilder,
  sleep,
} from "@l-v-yonsama/rdh";
import { createHash } from "crypto";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";
import {
  commands,
  ExtensionContext,
  NotebookCellData,
  NotebookCellKind,
  ProgressLocation,
  Uri,
  window,
} from "vscode";
import { BOTTOM_DIFF_MDH_VIEWID, CREATE_NEW_NOTEBOOK } from "../constant";
import {
  ActionCommand,
  CompareParams,
  CreateUndoChangeSqlActionCommand,
  OutputParams,
} from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { DiffMdhViewEventData, DiffTabItem } from "../shared/MessageEventData";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { DiffMdhViewTabParam } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { createBookFromDiffList } from "../utilities/excelGenerator";
import { createHtmlFromDiffList } from "../utilities/htmlGenerator";
import { StateStorage } from "../utilities/StateStorage";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";

const PREFIX = "[DiffMdhView]";

dayjs.extend(utc);

export class DiffMdhViewProvider extends BaseViewProvider {
  private currentTabId?: string;
  private currentInnerIndex?: number;
  private items: DiffTabItem[] = [];

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "DiffMdhView";
  }

  async render(params: DiffMdhViewTabParam) {
    if (this.webviewView === undefined) {
      await commands.executeCommand("setContext", BOTTOM_DIFF_MDH_VIEWID + ".visible", true);
    }

    await commands.executeCommand(BOTTOM_DIFF_MDH_VIEWID + ".focus", { preserveFocus: true });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.renderSub(params);
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
            await commands.executeCommand("setContext", BOTTOM_DIFF_MDH_VIEWID + ".visible", false);
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
      case "selectInnerTab":
        {
          const { tabId, innerIndex } = params;
          const tabItem = this.getTabItemById(tabId);
          if (!tabItem) {
            return;
          }
          this.currentTabId = tabId;
          this.currentInnerIndex = innerIndex;
          showStatusMessage(tabItem.list[innerIndex].diffResult.message);
        }
        break;

      case "compare":
        this.compare(params);
        return;
      case "output":
        this.output(params);
        return;
      case "createUndoChangeSql":
        this.createUndoChangeSql(params);
        return;
    }
  }

  protected onDidChangeVisibility(visible: boolean): void {
    if (visible === true && this.currentTabId) {
      this.postMessage<DiffMdhViewEventData>({
        command: "initialize",
        componentName: "DiffMdhView",

        value: {
          initialize: {
            tabItems: this.items,
            currentTabId: this.currentTabId,
            currentInnerIndex: this.currentInnerIndex,
          },
        },
      });
    }
  }

  private async createTabItem(
    title: string,
    comparable: boolean,
    undoable: boolean,
    list1: ResultSetData[],
    list2: ResultSetData[]
  ): Promise<DiffTabItem | undefined> {
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
    list1.forEach((it) => RdhHelper.clearAllAnotations(it));
    list2.forEach((it) => RdhHelper.clearAllAnotations(it));

    const createTabId = () => createHash("md5").update(title).digest("hex");
    const tabId = createTabId();

    let item: DiffTabItem | undefined = {
      tabId,
      title,
      subTitle,
      comparable,
      undoable,
      hasUndoChangeSql: false,
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
            item = undefined;
            showWindowErrorMessage("Cancelled");
            return;
          }

          await sleep(10);
          const diffResult = await asyncDiff(rdh1, rdh2, token);
          if (diffResult.ok === false) {
            item = undefined;
            showWindowErrorMessage(diffResult.message);
            return;
          }

          if (rdh1.meta.tableRule) {
            await runRuleEngine(rdh1);
          }
          if (rdh2.meta.tableRule) {
            await runRuleEngine(rdh2);
          }
          if (rdh1.meta.codeItems) {
            await resolveCodeLabel(rdh1);
          }
          if (rdh2.meta.codeItems) {
            await resolveCodeLabel(rdh2);
          }
          const { tableName, schemaName } = rdh1.meta;

          let undoChangeStatements: string[] | undefined = undefined;
          if (tableName && undoable) {
            const undoChangeResult = diffToUndoChanges(rdh1, rdh2);
            let sqlLang: SQLLang = "sql";
            if (rdh1.meta.connectionName) {
              const dbType = this.stateStorage?.getDBTypeByConnectionName(rdh1.meta.connectionName);
              if (dbType === DBType.Aws) {
                sqlLang = "partiql";
              }
            }
            const list = createUndoChangeSQL({
              schemaName,
              tableName,
              columns: rdh1.keys,
              bindOption: {
                specifyValuesWithBindParameters: false,
              },
              diffResult: undoChangeResult,
              sqlLang,
            });
            undoChangeStatements = list.map((it) => it.query);
          }

          item!.list.push({
            tabId: createTabId(),
            title: rdh1.meta.tableName ?? "",
            diffResult,
            undoChangeStatements,
            rdh1,
            rdh2,
          });

          item!.hasUndoChangeSql = item!.list.some(
            (it) => (it.undoChangeStatements?.length ?? 0) > 0
          );
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

  private async renderSub(params: DiffMdhViewTabParam): Promise<DiffTabItem | undefined> {
    const { title, list1, comparable, undoable, list2 } = params;
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      const tmpItem = await this.createTabItem("tmp", comparable, undoable, list1, list2);
      if (!tmpItem) {
        if (this.items.length === 0) {
          this.webviewView = undefined;
          this.currentTabId = undefined;
          this.currentInnerIndex = undefined;
          await commands.executeCommand("setContext", BOTTOM_DIFF_MDH_VIEWID + ".visible", false);
        }
        return;
      }
      item.list = tmpItem.list;
      item.subTitle = tmpItem.subTitle;
      item.hasUndoChangeSql = tmpItem.hasUndoChangeSql;

      const msg: DiffMdhViewEventData = {
        command: "set-search-result",
        componentName: "DiffMdhView",
        value: {
          searchResult: {
            tabId: item.tabId,
            value: item,
          },
        },
      };
      this.postMessage<DiffMdhViewEventData>(msg);
      this.currentTabId = item.tabId;
      return item;
    }

    item = await this.createTabItem(title, comparable, undoable, list1, list2);
    if (!item) {
      if (this.items.length === 0) {
        this.webviewView = undefined;
        this.currentTabId = undefined;
        this.currentInnerIndex = undefined;
        await commands.executeCommand("setContext", BOTTOM_DIFF_MDH_VIEWID + ".visible", false);
      }
      return;
    }
    this.items.push(item);
    this.currentTabId = item.tabId;

    const msg2: DiffMdhViewEventData = {
      command: "add-tab-item",
      componentName: "DiffMdhView",
      value: {
        addTabItem: item,
      },
    };
    this.postMessage<DiffMdhViewEventData>(msg2);
    return item;
  }

  private async createUndoChangeSql(params: CreateUndoChangeSqlActionCommand["params"]) {
    const { tabId } = params;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    // Undo Changes
    const hasUndoChangeStatements = tabItem.list.some(
      (it) => it.undoChangeStatements !== undefined && it.undoChangeStatements.length > 0
    );

    if (!hasUndoChangeStatements) {
      return;
    }
    const contents: string[] = [];

    const baseList = tabItem.list.map((it) => it.rdh1);
    const conNames = [...new Set(baseList.map((it) => it.meta.connectionName + ""))];

    contents.push(`const startTime = new Date().getTime();`);
    contents.push(`let totalAffectedRows = 0;`);
    contents.push(
      `const rdb = new ResultSetDataBuilder([{name:'affectedRows',type:'numeric'},{name:'sql',type:'text',width:500,align:'left'}]);`
    );
    contents.push(``);
    contents.push(`const requestSql = async (driver, sql) => {`);
    contents.push(
      `  // https://github.com/l-v-yonsama/db-drivers/blob/main/doc/classes/RDSBaseDriver.md#requestsql `
    );
    contents.push(`  const r = await driver.requestSql({ sql });`);
    contents.push(`  const affectedRows = r?.summary?.affectedRows ?? 0;`);
    contents.push(`  totalAffectedRows += affectedRows;`);
    contents.push(`  rdb.addRow({ affectedRows, sql });`);
    contents.push(`};`);
    contents.push(``);

    for (let i = 0; i < conNames.length; i++) {
      const conName = conNames[i];
      const setting = await this.stateStorage?.getConnectionSettingByName(conName);
      if (!setting) {
        continue;
      }
      const undoList = tabItem.list.filter(
        (it) =>
          it.rdh1.meta.connectionName === conName &&
          it.undoChangeStatements &&
          it.undoChangeStatements.length > 0
      );
      if (undoList.length === 0) {
        continue;
      }
      contents.push(`const con${i + 1} = getConnectionSettingByName('${conName}');`);
      if (setting.dbType === DBType.Aws) {
        contents.push(
          `const result${i + 1} = await DBDriverResolver.getInstance().workflow(con${
            i + 1
          }, async (driver) => {`
        );
      } else {
        contents.push(
          `const result${i + 1} = await DBDriverResolver.getInstance().flowTransaction(con${
            i + 1
          }, async (driver) => {`
        );
      }
      undoList.forEach((it, index) => {
        contents.push(`  // ${index + 1}:${it.rdh1.meta.tableName}`);
        it.undoChangeStatements?.forEach((sql) => {
          contents.push(
            `  await requestSql(driver, "${sql.replace(/"/g, '\\"').replace(/\n/g, "\\n")}");`
          );
        });
        contents.push("");
      });
      if (setting.dbType === DBType.Aws) {
        contents.push(`});`);
      } else {
        contents.push(`},{ transactionControlType: 'rollbackOnError' }`);
        contents.push(`);`);
      }
      contents.push(`console.log('result${i + 1}', JSON.stringify(result${i + 1}, null, 2));`);
    }
    contents.push(``);
    contents.push(`const elapsedTimeMilli = new Date().getTime() - startTime;`);
    contents.push(`rdb.setSummary({`);
    contents.push(`  elapsedTimeMilli,`);
    contents.push(`  affectedRows: totalAffectedRows`);
    contents.push(`});`);
    contents.push(`writeResultSetData('Undo changes results', rdb.build());`);

    const cell = new NotebookCellData(NotebookCellKind.Code, contents.join("\n"), "javascript");

    commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);

    //   let totalAffectedRows
  }

  private async output(data: OutputParams) {
    const { tabId } = data;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const { title } = tabItem;
    const fileExtension = data.fileType === "excel" ? "xlsx" : "html";
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${title}_diff.${fileExtension}`;
    const previousFolder = await this.stateStorage.getPreviousSaveFolder();
    const baseUri = previousFolder ? Uri.file(previousFolder) : Uri.file("./");
    const uri = await window.showSaveDialog({
      defaultUri: Uri.joinPath(baseUri, defaultFileName),
      filters: { "*": [fileExtension] },
    });
    if (!uri) {
      return;
    }
    await this.stateStorage.setPreviousSaveFolder(path.dirname(uri.fsPath));
    const message =
      data.fileType === "excel"
        ? await createBookFromDiffList(tabItem.list, uri.fsPath, {
            rdh: {
              outputAllOnOneSheet: false,
            },
            diff: {
              displayOnlyChanged: data.displayOnlyChanged ?? false,
            },
            rule: {
              withRecordRule: true,
            },
          })
        : await createHtmlFromDiffList(tabItem.list, uri.fsPath);
    if (message) {
      showWindowErrorMessage(message);
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
                  prepare: rdh.meta?.useDatabase
                    ? { useDatabaseName: rdh.meta.useDatabase }
                    : undefined,
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
        progress.report({ increment: 100 });
      }
    );

    const diffParams: DiffMdhViewTabParam = {
      title: tabItem.title,
      comparable: tabItem.comparable,
      undoable: tabItem.undoable,
      list1: beforeList,
      list2: afterList.map((it) => it!),
    };
    if (afterList.some((it) => it === undefined)) {
      return;
    }
    await this.renderSub(diffParams);
  }
}
