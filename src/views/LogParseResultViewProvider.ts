import {
  createLogResultBuilder,
  createSqlResultBuilder,
  ExtractedSqlRdhResult,
  ExtractedSqlResult,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { createHash } from "crypto";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import * as path from "path";
import {
  commands,
  ExtensionContext,
  NotebookCellData,
  NotebookCellKind,
  Uri,
  window,
} from "vscode";
import { BOTTOM_LOG_PARSE_RESULT_VIEWID, CREATE_NEW_NOTEBOOK } from "../constant";
import {
  ActionCommand,
  OutputParams,
  TabIdParam,
  WriteToClipboardParams,
} from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import {
  LogParsedTabItem,
  LogParseResultViewEventData,
  RdhViewConfig,
} from "../shared/MessageEventData";
import { hideStatusMessage, showStatusMessage } from "../statusBar";
import { CellMeta } from "../types/Notebook";
import { LogParseResultViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { copyToClipboard } from "../utilities/clipboardUtil";
import { getRdhViewConfig } from "../utilities/configUtil";
import { createLogAnalysisWorkbook } from "../utilities/excelGenerator";
import { createHtmlFromRdhList } from "../utilities/htmlGenerator";
import { log } from "../utilities/logger";
import { rdhListToText } from "../utilities/rdhToText";
import { StateStorage } from "../utilities/StateStorage";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";

const PREFIX = "[LogParseResultView]";
dayjs.extend(utc);

export class LogParseResultViewProvider extends BaseViewProvider {
  private currentTabId?: string;
  private currentInnerIndex?: number;
  private items: LogParsedTabItem[] = [];

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "LogParseResultView";
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
            await commands.executeCommand(
              "setContext",
              BOTTOM_LOG_PARSE_RESULT_VIEWID + ".visible",
              false
            );
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

          const rdh = tabItem.list[innerIndex];
          const info = rdh.summary?.info ?? "";
          showStatusMessage(info);
        }
        break;
      case "openInNoteBook":
        this.openInNoteBook(params);
        return;
      case "output":
        this.output(params);
        return;
      case "showMessage":
        await showWindowErrorMessage(params.message);
        return;
      case "writeToClipboard":
        this.writeToClipboard(params);
        return;
    }
  }

  async render(params: LogParseResultViewParams) {
    if (this.webviewView === undefined) {
      await commands.executeCommand(
        "setContext",
        BOTTOM_LOG_PARSE_RESULT_VIEWID + ".visible",
        true
      );
    }

    await commands.executeCommand(BOTTOM_LOG_PARSE_RESULT_VIEWID + ".focus", {
      preserveFocus: true,
    });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.renderSub(params);
  }

  protected onDidChangeVisibility(visible: boolean): void {
    log(
      `${this.getComponentName()} onDidChangeVisibility visible:[${visible}]currentTabId:[${
        this.currentTabId
      }]`
    );
    if (visible === true && this.currentTabId) {
      this.postMessage<LogParseResultViewEventData>({
        command: "initialize",
        componentName: "LogParseResultView",
        value: {
          initialize: {
            tabItems: this.items,
            currentTabId: this.currentTabId,
            currentInnerIndex: this.currentInnerIndex,
          },
          config: this.getCustomizedRdhViewConfig(),
        },
      });
    }
  }

  private getTabByTitle(title: string): LogParsedTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }

  private getTabItemById(tabId: string): LogParsedTabItem | undefined {
    return this.items.find((it) => it.tabId === tabId);
  }

  private async renderSub(params: LogParseResultViewParams): Promise<LogParsedTabItem | undefined> {
    const { title, totalLogLines, linesToParse, rawLogs, extractedSqlResult } = params;
    const list: ResultSetData[] = [];
    if (rawLogs) {
      list.push(rawLogs);
    }
    this.currentInnerIndex = undefined;
    let item = this.getTabByTitle(title);
    let sqlResult: ExtractedSqlRdhResult | undefined = undefined;

    if (extractedSqlResult && extractedSqlResult.ok) {
      sqlResult = convertExtractedSqlRdhResult(extractedSqlResult);
      if (sqlResult.logEvents) {
        list.unshift(sqlResult.logEvents);
      }
      if (sqlResult.sqlEvents) {
        list.unshift(sqlResult.sqlEvents);
      }
    }

    if (item) {
      // Reset
      item.totalLogLines = totalLogLines;
      item.linesToParse = linesToParse;
      item.rawLogs = rawLogs;
      item.logEvents = sqlResult?.logEvents;
      item.sqlEvents = sqlResult?.sqlEvents;
      item.list = list;
      item.extractedSqlResult = extractedSqlResult;

      this.postMessage<LogParseResultViewEventData>({
        command: "set-search-result",
        componentName: "LogParseResultView",

        value: {
          searchResult: {
            tabId: item.tabId,
            value: item.list,
            extractedSqlResult: extractedSqlResult,
          },
          config: this.getCustomizedRdhViewConfig(),
        },
      });
      this.currentTabId = item.tabId;
      return item;
    }

    item = this.createTabItem(params, list, sqlResult);
    this.items.push(item);
    this.currentTabId = item.tabId;

    this.postMessage<LogParseResultViewEventData>({
      command: "add-tab-item",
      componentName: "LogParseResultView",
      value: {
        addTabItem: item,
        config: this.getCustomizedRdhViewConfig(),
      },
    });
  }

  private createTabItem(
    params: LogParseResultViewParams,
    list: ResultSetData[],
    sqlResult?: ExtractedSqlRdhResult
  ): LogParsedTabItem {
    const { title, totalLogLines, linesToParse, rawLogs, extractedSqlResult } = params;
    const tabId = createHash("md5").update(title).digest("hex");

    const item: LogParsedTabItem = {
      tabId,
      title,
      totalLogLines,
      linesToParse,
      rawLogs,
      logEvents: sqlResult?.logEvents,
      sqlEvents: sqlResult?.sqlEvents,
      list,
      extractedSqlResult,
    };
    return item;
  }

  private async output(data: OutputParams) {
    const { tabId } = data;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const {
      title,
      totalLogLines,
      linesToParse,
      rawLogs,
      logEvents,
      sqlEvents,
      extractedSqlResult,
    } = tabItem;
    if (!logEvents || !extractedSqlResult) {
      return;
    }
    const fileExtension = data.fileType === "excel" ? "xlsx" : "html";
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${title}.${fileExtension}`;
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
    let message = "";
    if (data.fileType === "excel") {
      message = await createLogAnalysisWorkbook({
        totalLogLines,
        linesToParse,
        rawLogs,
        logEvents,
        sqlEvents,
        extractedResult: extractedSqlResult,
        targetExcelPath: uri.fsPath,
      });
    } else {
      message = await createHtmlFromRdhList(tabItem.list, uri.fsPath);
    }

    if (message) {
      showWindowErrorMessage(message);
    } else {
      window.setStatusBarMessage(uri.fsPath, 3000);
    }
  }

  private async openInNoteBook(data: TabIdParam) {
    const { tabId } = data;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }
    const { title, list, extractedSqlResult } = tabItem;

    const cells: NotebookCellData[] = [];
    for (const execution of extractedSqlResult?.sqlExecutions ?? []) {
      const { startLine, endLine, timestamp, type, formattedSql, sql, error, errorDetail } =
        execution;
      let cell: NotebookCellData;
      if ((type ?? "").toLocaleLowerCase() === "error") {
        let content = `\`[ERROR]:\` Line:${startLine} 〜 ${endLine}, Timestamp:${timestamp}`;
        content += `\n\n\`\`\`\n${error}\n\`\`\``;
        if (errorDetail) {
          content += `\n\n\`\`\`\n${errorDetail}\n\`\`\``;
        }
        cell = new NotebookCellData(NotebookCellKind.Markup, content, "markdown");
      } else {
        const header = `-- Line:${startLine} 〜 ${endLine}, Timestamp:${timestamp}`;
        const content = `${header}\n${formattedSql ?? sql ?? ""}`;
        cell = new NotebookCellData(NotebookCellKind.Code, content, "sql");
      }
      const metadata: CellMeta = {};
      cell.metadata = metadata;
      cells.push(cell);
    }

    commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
  }

  private async writeToClipboard(params: WriteToClipboardParams) {
    const { tabId } = params;
    const tabItem = this.getTabItemById(tabId);
    if (!tabItem) {
      return;
    }

    await copyToClipboard(rdhListToText(tabItem.list, params));
  }

  private getCustomizedRdhViewConfig(): RdhViewConfig {
    const rdhViewConfig = getRdhViewConfig();
    rdhViewConfig.hideRowColumn = true;
    rdhViewConfig.displayComment = false;
    rdhViewConfig.displayType = false;
    return rdhViewConfig;
  }
}

export function convertExtractedSqlRdhResult(params: ExtractedSqlResult): ExtractedSqlRdhResult {
  const { elapsedTimeMilli, inputSummary } = params;

  const logEventRdb = createLogResultBuilder(params.logEvents, params.stage, {
    elapsedTimeMilli: elapsedTimeMilli.split + (elapsedTimeMilli.classification ?? 0),
    logEventSplitPattern: inputSummary.logEventSplitPattern,
    classificationSummary: inputSummary.classificationSummary,
  });

  let sqlEventRdb: ResultSetDataBuilder | null = null;
  if (params.stage === "sqlExecution") {
    sqlEventRdb = createSqlResultBuilder(params.sqlExecutions, {
      elapsedTimeMilli: elapsedTimeMilli.sqlExecutions ?? 0,
      extractionSummary: inputSummary.extractionSummary,
    });
  }

  return {
    logEvents: logEventRdb.build(),
    sqlEvents: sqlEventRdb ? sqlEventRdb.build() : undefined,
  };
}
