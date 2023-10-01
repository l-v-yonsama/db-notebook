import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  ProgressLocation,
  commands,
  NotebookCellData,
  NotebookCellKind,
} from "vscode";
import {
  DBDriverResolver,
  RDSBaseDriver,
  RdhHelper,
  ResultSetData,
  ResultSetDataBuilder,
  createUndoChangeSQL,
  diff,
  diffToUndoChanges,
  resolveCodeLabel,
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { StateStorage, sleep } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";
import { createHash } from "crypto";
import {
  ActionCommand,
  CompareParams,
  CreateUndoChangeSqlActionCommand,
  OutputParams,
} from "../shared/ActionParams";
import { createWebviewContent } from "../utilities/webviewUtil";
import { createBookFromDiffList } from "../utilities/excelGenerator";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { log } from "../utilities/logger";
import { DiffPanelEventData, DiffTabItem } from "../shared/MessageEventData";
import { getIconPath } from "../utilities/fsUtil";
import { CREATE_NEW_NOTEBOOK } from "../constant";

const PREFIX = "[DiffPanel]";

dayjs.extend(utc);

const componentName = "DiffPanel";

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
    this._panel.webview.html = createWebviewContent(
      this._panel.webview,
      extensionUri,
      componentName
    );
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
        "Diff",
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
      panel.iconPath = getIconPath("git-compare.svg");
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
            return;
          }

          await sleep(10);
          const diffResult = diff(rdh1, rdh2);
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
          if (tableName) {
            const undoChangeResult = diffToUndoChanges(rdh1, rdh2);
            const list = createUndoChangeSQL({
              schemaName,
              tableName,
              columns: rdh1.keys,
              bindOption: {
                specifyValuesWithBindParameters: false,
              },
              diffResult: undoChangeResult,
            });
            undoChangeStatements = list.map((it) => it.query);
          }

          item.list.push({
            tabId: createTabId(),
            title: rdh1.meta.tableName ?? "",
            diffResult,
            undoChangeStatements,
            rdh1,
            rdh2,
          });

          item.hasUndoChangeSql = item.list.some(
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

  async renderSub(params: DiffTabParam): Promise<DiffTabItem | undefined> {
    const { title, list1, list2 } = params;
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      const tmpItem = await this.createTabItem("tmp", list1, list2);
      item.list = tmpItem.list;
      item.subTitle = tmpItem.subTitle;

      const msg: DiffPanelEventData = {
        command: "set-search-result",
        componentName: "DiffPanel",
        value: {
          searchResult: {
            tabId: item.tabId,
            value: item,
          },
        },
      };
      this._panel.webview.postMessage(msg);
      return item;
    }

    item = await this.createTabItem(title, list1, list2);
    this.items.push(item);

    const msg2: DiffPanelEventData = {
      command: "add-tab-item",
      componentName: "DiffPanel",
      value: {
        addTabItem: item,
      },
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
          case "createUndoChangeSql":
            this.createUndoChangeSql(params);
            return;
        }
      },
      undefined,
      this._disposables
    );
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
      const setting = await DiffPanel.stateStorage?.getConnectionSettingByName(conName);
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
      contents.push(
        `const result${i + 1} = await DBDriverResolver.getInstance().flowTransaction(con${
          i + 1
        }, async (driver) => {`
      );
      undoList.forEach((it, index) => {
        contents.push(`  // ${index + 1}:${it.rdh1.meta.tableName}`);
        it.undoChangeStatements?.forEach((sql) => {
          contents.push(`  await requestSql(driver, "${sql.replace('"', '\\"')}");`);
        });
        contents.push("");
      });
      contents.push(`},{ transactionControlType: 'rollbackOnError' }`);
      contents.push(`);`);
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
                if (rdh.meta.codeItems) {
                  afterRdh.meta.codeItems = rdh.meta.codeItems;
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
