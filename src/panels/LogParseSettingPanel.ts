import {
  createLogEventPatternText,
  detectLogSplitPreset,
  detectSqlParsePresetByText,
  ExtractedSqlResult,
  formatLogDetectionMessage,
  FORMATTER_SQL_LANGUAGES,
  LOG_EVENT_SPLIT_PRESETS,
  LogEventSplitConfig,
  LogEventSplitPresetName,
  LogFormatDetectionResult,
  LogParseConfig,
  LogParseParams,
  LogParser,
  LogParseStage,
  SQL_LOG_PARSE_PRESETS,
  SqlLogParsePresetName,
  summarizeClassifyRules,
  summarizeExtractors,
  validateConfig,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { createRdhKey, GeneralColumnType, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { applyEdits, modify } from "jsonc-parser";
import * as path from "path";
import * as vscode from "vscode";
import { commands, TextDocument, Uri, ViewColumn, WebviewPanel, window, workspace } from "vscode";
import { OPEN_LOG_PARSE_RESULT_VIEWER } from "../constant";
import { ActionCommand, SaveLogOptionParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { LabelValueItem } from "../shared/LabelValueItem";
import {
  LogParseSettingPanelEventData,
  LogParseSettingPanelEventDataConfigSummary,
  LogParseSettingPanelEventDataPreset,
} from "../shared/MessageEventData";
import { LogParseResultViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import {
  existsFileOnWorkspace,
  getIconPath,
  readResource,
  writeToResource,
} from "../utilities/fsUtil";
import { BasePanel } from "./BasePanel";

const PREFIX = "[LogParseSettingPanel]";

export class LogParseSettingPanel extends BasePanel {
  public static currentPanel: LogParseSettingPanel | undefined;
  private logFileUri: Uri | undefined;
  private logParserConfigFileUri: Uri | null = null;
  private logParserConfigDoc: TextDocument | null = null;
  private rawText: string = "";
  private formatterSqlLanguage: LogParseParams["language"];
  private totalLogLines = 0;
  private linesToParse = 100;
  private disposableSubscriptions: vscode.Disposable[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);

    this.disposableSubscriptions.push(
      workspace.onDidChangeTextDocument((e) => {
        if (
          this.logParserConfigFileUri &&
          e.document.uri.toString() === this.logParserConfigFileUri.toString()
        ) {
          this.resetConfig(true);
        }
      })
    );
    this.disposableSubscriptions.push(
      window.onDidChangeVisibleTextEditors((editors) => {
        const uris = editors.map((e) => e.document.uri.toString());
        this.setConfigEditorVisibility();
      })
    );
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    LogParseSettingPanel.currentPanel = new LogParseSettingPanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, logFileUri: Uri) {
    if (LogParseSettingPanel.currentPanel) {
      LogParseSettingPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "LogParseSettingType",
        "LogParseSetting",
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
      panel.iconPath = getIconPath("output.svg");
      LogParseSettingPanel.currentPanel = new LogParseSettingPanel(panel, extensionUri);
    }
    // vscode.window.activeColorTheme.kind===ColorThemeKind.Dark
    LogParseSettingPanel.currentPanel.logFileUri = logFileUri;
    LogParseSettingPanel.currentPanel.formatterSqlLanguage = undefined;
    LogParseSettingPanel.currentPanel.initialize();
  }

  getComponentName(): ComponentName {
    return "LogParseSettingPanel";
  }

  async initialize() {
    const { logFileUri, formatterSqlLanguage } = this;
    if (!logFileUri) {
      return;
    }

    const wsfolder = workspace.workspaceFolders?.[0].uri;
    if (!wsfolder) {
      return;
    }
    const rootPath = wsfolder.fsPath;
    const logParserConfigUris = await workspace.findFiles(
      "**/*.log-parser.config.json",
      "**/{node_modules,dist,build,out,coverage,.git,.next,.nuxt,classes}/**"
    );
    const logParserConfigItems: LabelValueItem[] = (logParserConfigUris ?? []).map((it) => ({
      label: path.relative(rootPath, it.fsPath),
      value: path.relative(rootPath, it.fsPath),
    }));

    this.totalLogLines = 0;
    this.linesToParse = 100;
    try {
      this.rawText = await readResource(this.logFileUri!);
      this.totalLogLines = this.countLines(this.rawText);
      if (this.totalLogLines > 100) {
        this.linesToParse = 100;
      } else {
        this.linesToParse = -1;
      }
      await this.showLogParseResultView();
    } catch (e) {
      showWindowErrorMessage(e);
    }
    await this.resetConfig();
    const { configSummary, errorMessage } = this.createConfigSummary();
    const preset = await this.createPreset();
    const msg: LogParseSettingPanelEventData = {
      command: "initialize",
      componentName: "LogParseSettingPanel",
      value: {
        initialize: {
          formatterSqlLanguage,
          formatterSqlLanguageItems: FORMATTER_SQL_LANGUAGES.map((it) => ({
            label: toDisplayName(it),
            value: it,
          })),
          logParserConfigFile: this.logParserConfigFileUri
            ? path.relative(rootPath, this.logParserConfigFileUri.fsPath)
            : "",
          logParserConfigItems,
          linesToParse: this.linesToParse,
          totalLogLines: this.totalLogLines,
          configSummary,
          preset,
          errorMessage,
        },
      },
    };
    this.panel.webview.postMessage(msg);
  }

  public preDispose(): void {
    LogParseSettingPanel.currentPanel = undefined;
    this.disposableSubscriptions.forEach((it) => it.dispose());
    this.disposableSubscriptions = [];
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "ok":
        {
          if (!LogParseSettingPanel.currentPanel) {
            return;
          }
          const { action, linesToParse, presetName, logParserConfigFile, sqlLanguage } =
            params as SaveLogOptionParams;

          switch (action) {
            case "create-new-config":
              const newPath = await this.createLogParserConfigFile();
              await this.resetConfigFile(newPath);
              break;
            case "open-as-json":
              this.openJsonEditor(true);
              break;
            case "reset-lines":
              if (linesToParse !== undefined) {
                this.linesToParse = linesToParse;
              }
              this.showLogParseResultView();
              break;
            case "reset-formatter-sql-language":
              this.formatterSqlLanguage = sqlLanguage;
              break;
            case "apply-log-event-split-preset":
              if (presetName) {
                await this.applyLogEventSplitPreset(presetName as LogEventSplitPresetName);
                await this.resetConfig(true);
              }
              break;
            case "apply-parser-sql-preset":
              if (presetName) {
                await this.applySqlParsePreset(presetName as SqlLogParsePresetName);
                await this.resetConfig(true);
              }
              break;
            case "parse":
              await this.parseLog();
              break;
            case "test-split":
              await this.parseLog("split");
              break;
            case "set-config-file":
              await this.resetConfigFile(logParserConfigFile);
              break;
          }
        }

        return;
    }
  }

  async resetConfigFile(logParserConfigFile: string | undefined) {
    if (logParserConfigFile) {
      if (!(await existsFileOnWorkspace(logParserConfigFile!))) {
        showWindowErrorMessage("File is not exists on workspace." + logParserConfigFile);
        return;
      }
      const wsfolder = workspace.workspaceFolders?.[0].uri;
      if (!wsfolder) {
        return;
      }
      this.logParserConfigFileUri = Uri.joinPath(wsfolder, logParserConfigFile);
      await this.openJsonEditor(false);
    } else {
      this.logParserConfigFileUri = null;
    }
    await this.resetConfig(true);
    this.setConfigEditorVisibility();
  }

  async createLogParserConfigFile(): Promise<string | undefined> {
    const fileFilters = {
      logParserConfigJSON: ["log-parser.config.json"],
    };
    let wsfolder = workspace.workspaceFolders?.[0].uri?.fsPath ?? "";

    // TODO: 対象のログファイル(this.logFileUri)の名称から命名したい(考慮不足な単純な例：`${this.logFileUri}.log-parser.config.json`)
    let uri = await window.showSaveDialog({
      defaultUri: Uri.file(path.join(wsfolder, "untitled.log-parser.config.json")),
      filters: fileFilters,
      title: "Save Log parser config JSON file(*.log-parser.config.json)",
    });

    if (!uri) {
      return;
    }
    if (!uri.fsPath.endsWith(".log-parser.config.json")) {
      const retry = await window.showWarningMessage(
        "File name must end with '.log-parser.config.json'. Retry?",
        "Yes",
        "Cancel"
      );

      if (retry === "Yes") {
        uri = await window.showSaveDialog({
          defaultUri: Uri.file(path.join(wsfolder, "untitled.log-parser.config.json")),
          filters: fileFilters,
          title: "Save Log parser config JSON file(*.log-parser.config.json)",
        });
      }
    }
    if (!uri) {
      return;
    }

    const obj: LogParseConfig = {
      split: {
        fields: [],
      },
      classify: [],
      extractors: [],
    };
    await writeToResource(uri, JSON.stringify(obj, null, 2));

    const logParserConfigUris = await workspace.findFiles(
      "**/*.log-parser.config.json",
      "**/{node_modules,dist,build,out,coverage,.git,.next,.nuxt,classes}/**"
    );
    const logParserConfigItems: LabelValueItem[] = (logParserConfigUris ?? []).map((it) => ({
      label: path.relative(wsfolder, it.fsPath),
      value: path.relative(wsfolder, it.fsPath),
    }));
    const msg: LogParseSettingPanelEventData = {
      command: "reset-config-file-and-items",
      componentName: "LogParseSettingPanel",
      value: {
        "reset-config-file-and-items": {
          logParserConfigFile: path.relative(wsfolder, uri.fsPath),
          logParserConfigItems,
        },
      },
    };
    this.panel.webview.postMessage(msg);

    return path.relative(wsfolder, uri.fsPath);
  }

  private setConfigEditorVisibility() {
    let visibility = false;
    if (this.logParserConfigFileUri) {
      visibility = window.visibleTextEditors.some(
        (e) => e.document.uri.toString() === this.logParserConfigFileUri!.toString()
      );
    }
    const msg: LogParseSettingPanelEventData = {
      command: "set-config-editor-visibility",
      componentName: "LogParseSettingPanel",
      value: {
        "set-config-editor-visibility": visibility,
      },
    };
    this.panel.webview.postMessage(msg);
  }

  async openJsonEditor(showTextDocument = false) {
    if (!this.logParserConfigFileUri) {
      return;
    }
    this.logParserConfigDoc = await workspace.openTextDocument(this.logParserConfigFileUri);
    if (showTextDocument) {
      await window.showTextDocument(this.logParserConfigDoc, ViewColumn.Beside);
    }
  }

  private getLogEventSplitConfigByPreset(presetName: LogEventSplitPresetName): LogEventSplitConfig {
    const { logExample, split } = LOG_EVENT_SPLIT_PRESETS[presetName];
    return split;
  }

  private countLines(text: string): number {
    if (!text) {
      return 0;
    }

    let count = 1;

    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);

      if (c === 10) {
        // \n
        count++;
      } else if (c === 13) {
        // \r
        if (text.charCodeAt(i + 1) !== 10) {
          count++;
        }
      }
    }

    return count;
  }

  private async resetConfig(postMessage = false): Promise<void> {
    const preset = await this.createPreset();
    const { configSummary, errorMessage, canSplitLog } = this.createConfigSummary();

    if (postMessage) {
      const msg: LogParseSettingPanelEventData = {
        command: "reset-config",
        componentName: "LogParseSettingPanel",
        value: {
          "reset-config": {
            configSummary,
            canSplitLog,
            errorMessage,
            preset,
          },
        },
      };
      this.panel.webview.postMessage(msg);
    }
  }

  private createConfigSummary(): {
    canSplitLog: boolean;
    errorMessage: string;
    configSummary: LogParseSettingPanelEventDataConfigSummary;
  } {
    let logEventSplitPattern = "";
    let classificationSummary = "";
    let extractionSummary = "";
    let errorMessage = "";
    let canSplitLog = false;

    if (this.logParserConfigDoc) {
      let logParseConfig: LogParseConfig | null = null;
      try {
        logParseConfig = JSON.parse(this.logParserConfigDoc.getText()) as LogParseConfig;
      } catch (e) {
        errorMessage = `JSON.parse error.${(e as Error).message}`;
      }
      if (!errorMessage) {
        if (logParseConfig && logParseConfig.split && logParseConfig.split.fields?.length > 0) {
          logEventSplitPattern = createLogEventPatternText({
            ...logParseConfig.split,
            targetForHuman: true,
          });

          const validateResult = validateConfig(logParseConfig);
          if (validateResult.ok && logParseConfig) {
            classificationSummary = summarizeClassifyRules(logParseConfig.classify);
            extractionSummary = summarizeExtractors(logParseConfig.extractors);
          } else if (validateResult.errorMessage) {
            errorMessage = validateResult.errorMessage;
          }
          canSplitLog = validateResult.availableStage !== undefined;
        } else {
          errorMessage = "Select 'Log split preset' and Apply";
        }
      }
    } else {
      errorMessage = "Select or Create log parser config file.";
    }

    return {
      errorMessage,
      canSplitLog,
      configSummary: {
        logEventSplitPattern,
        classificationSummary,
        extractionSummary,
      },
    };
  }

  private getCurrentConfig(): LogParseConfig | null {
    const { logParserConfigDoc } = this;
    if (!logParserConfigDoc) {
      return null;
    }
    return JSON.parse(logParserConfigDoc.getText()) as LogParseConfig;
  }

  private async createPreset(): Promise<LogParseSettingPanelEventDataPreset> {
    const { rawText } = this;
    const logParseConfig = this.getCurrentConfig();
    let sqlParseDetectionMessage = "";
    const logEventSplitPresets: LogParseSettingPanelEventDataPreset["logEventSplitPresets"] = [];
    const sqlParsePresets: LogParseSettingPanelEventDataPreset["sqlParsePresets"] = [];

    const splitConfidence = detectLogSplitPreset(this.rawText, LOG_EVENT_SPLIT_PRESETS);
    for (const [key, value] of Object.entries(LOG_EVENT_SPLIT_PRESETS)) {
      const recommended =
        splitConfidence.confidence >= 0.3 && splitConfidence.presetNames.includes(key);
      logEventSplitPresets.push({
        name: key,
        label: `${key}${recommended ? " (Recommended)" : ""}`,
        logExample: value.logExample,
        logFieldsPattern: createLogEventPatternText({
          ...value.split,
          targetForHuman: true,
        }),
      });
    }
    const logDetectionMessage = formatLogDetectionMessage(splitConfidence);

    if (rawText && logParseConfig) {
      let sqlParseConfidence: LogFormatDetectionResult | null = null;
      let errorMessage = "";
      try {
        sqlParseConfidence = await detectSqlParsePresetByText(
          rawText,
          logParseConfig,
          SQL_LOG_PARSE_PRESETS
        );
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : "" + e;
      }
      for (const [key, value] of Object.entries(SQL_LOG_PARSE_PRESETS)) {
        const recommended =
          sqlParseConfidence &&
          sqlParseConfidence.confidence >= 0.3 &&
          sqlParseConfidence.presetNames.includes(key);
        sqlParsePresets.push({
          value: key,
          label: `${key}${recommended ? " (Recommended)" : ""}`,
        });
      }
      if (sqlParseConfidence) {
        sqlParseDetectionMessage = formatLogDetectionMessage(sqlParseConfidence);
      } else {
        sqlParseDetectionMessage = errorMessage;
      }
    }

    return {
      logSplitDetectionMessage: logDetectionMessage,
      logEventSplitPresets,
      sqlParseDetectionMessage,
      sqlParsePresets,
    };
  }

  private async applyLogEventSplitPreset(logEventSplitPresetName: LogEventSplitPresetName) {
    if (!this.logParserConfigDoc) {
      return;
    }

    const document = this.logParserConfigDoc;
    const splitConfig = this.getLogEventSplitConfigByPreset(logEventSplitPresetName);
    const text = document.getText();

    const edits = modify(text, ["split"], splitConfig, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    });
    const newText = applyEdits(text, edits);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
    edit.replace(document.uri, fullRange, newText);

    await vscode.workspace.applyEdit(edit);
  }

  private async applySqlParsePreset(presetName: SqlLogParsePresetName) {
    const document = this.logParserConfigDoc;
    if (!document) {
      return;
    }

    const preset = SQL_LOG_PARSE_PRESETS[presetName];
    const keys: (keyof Pick<LogParseConfig, "classify" | "extractors">)[] = [
      "classify",
      "extractors",
    ];

    let text = document.getText();

    for (const key of keys) {
      const edits = modify(text, [key], preset[key], {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      });
      text = applyEdits(text, edits);
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, text);

    await vscode.workspace.applyEdit(edit);
  }

  private showLogParseResultView(extractedSqlResult?: ExtractedSqlResult) {
    const { logFileUri, linesToParse } = this;
    if (!logFileUri) {
      return;
    }
    const rdb = new ResultSetDataBuilder([
      createRdhKey({ name: "lineNo", type: GeneralColumnType.INTEGER, width: 80 }),
      createRdhKey({ name: "content", type: GeneralColumnType.TEXT, width: 1000 }),
    ]);
    const start = new Date().getTime();
    let rawLines = this.rawText.split(/\r?\n|\r/);
    if (linesToParse && linesToParse >= 0) {
      rawLines = rawLines.slice(0, linesToParse);
    }
    rawLines.forEach((text, index) => {
      rdb.addRow({ lineNo: index + 1, content: text });
    });
    rdb.updateMeta({
      type: "rawLog",
      tableName: "RAW-LOG",
    });
    rdb.setSummary({
      elapsedTimeMilli: new Date().getTime() - start,
      selectedRows: rdb.rs.rows.length,
    });

    const title = path.basename(logFileUri.fsPath);
    rdb.setSqlStatement(logFileUri.fsPath);
    const commandParams: LogParseResultViewParams = {
      title,
      rawLogs: rdb.build(),
      totalLogLines: this.totalLogLines,
      linesToParse: this.linesToParse,
      extractedSqlResult,
    };
    commands.executeCommand(OPEN_LOG_PARSE_RESULT_VIEWER, commandParams);
  }

  private async parseLog(stage?: LogParseStage): Promise<void> {
    const logParseConfig = this.getCurrentConfig();
    let sqlParsePresetVisibility = false;
    const { rawText, linesToParse } = this;
    if (!rawText || !logParseConfig) {
      return;
    }
    try {
      let targtStage = stage ?? "sqlExecution";
      const parser = new LogParser(logParseConfig);
      const extractedResult = await parser.parse({
        logText: rawText,
        stage: targtStage,
        language: this.formatterSqlLanguage,
        linesToParse,
      });
      if (extractedResult.ok) {
        sqlParsePresetVisibility = !!extractedResult.logEvents;
      }
      this.showLogParseResultView(extractedResult);
      await this.setParsePresetVisibility(sqlParsePresetVisibility);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showWindowErrorMessage(message);

      throw e;
    }
  }

  private async setParsePresetVisibility(visibility: boolean) {
    const msg: LogParseSettingPanelEventData = {
      command: "set-sql-parse-preset-visibility",
      componentName: "LogParseSettingPanel",
      value: {
        "set-sql-parse-preset-visibility": visibility,
      },
    };
    this.panel.webview.postMessage(msg);
  }
}

function toDisplayName(lang: string): string {
  switch (lang) {
    case "mysql":
      return "MySQL";
    case "postgresql":
      return "PostgreSQL";
    case "sqlite":
      return "SQLite";
    case "transactsql":
      return "SQL Server (T-SQL)";
    case "plsql":
      return "Oracle (PL/SQL)";
    default:
      return lang;
  }
}
