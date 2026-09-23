import {
  createLogEventPatternText,
  createLogResultBuilder,
  createSqlResultBuilder,
  detectLogSplitPreset,
  detectSqlParsePreset,
  ExtractedSqlResult,
  formatLogDetectionMessage,
  FORMATTER_SQL_LANGUAGES,
  LOG_EVENT_SPLIT_PRESETS,
  LogEventSplitConfig,
  LogEventSplitPresetName,
  LogParseConfig,
  LogParseParams,
  LogParser,
  SQL_LOG_PARSE_PRESETS,
  SqlLogParsePresetName,
  summarizeClassifyRules,
  summarizeExtractors,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { createRdhKey, GeneralColumnType, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import stringify from "fast-json-stable-stringify";
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
  LogParseSettingPanelEventDataPreset,
} from "../shared/MessageEventData";
import type {
  LogParseRunState,
  LogParseWorkflowState,
  LogParseSampleState,
} from "../shared/LogParseWorkflow";
import { readLogParseConfiguration } from "../utilities/logParseConfiguration";
import { LogParseResultViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import {
  existsFileOnWorkspace,
  getIconPath,
  readResource,
  writeToResource,
} from "../utilities/fsUtil";
import { BasePanel } from "./BasePanel";

const DEFAULT_SAMPLE_LINES = 500;

export class LogParseSettingPanel extends BasePanel {
  public static currentPanel: LogParseSettingPanel | undefined;
  private logFileUri: Uri | undefined;
  private logParserConfigFileUri: Uri | null = null;
  private logParserConfigDoc: TextDocument | null = null;
  private rawText: string = "";
  private formatterSqlLanguage: LogParseParams["language"];
  private totalLogLines = 0;
  private linesToParse = DEFAULT_SAMPLE_LINES;
  private configurationRevision = 0;
  private logVersion = 0;
  private initializationId = 0;
  private activeOperationId?: number;
  private lastResult?: LogParseRunState;
  private lastResultKey?: string;
  private splitTestKey?: string;
  private sampleLinesToParse = DEFAULT_SAMPLE_LINES;
  private splitSample?: LogParseSampleState;
  private sqlSample?: LogParseSampleState;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private previewTask?: Promise<void>;
  private previewPending = false;
  private previewVersion = 0;
  private previewKey?: string;
  private previewStatus: LogParseWorkflowState["previewStatus"] = "idle";
  private previewError?: string;
  private disposed = false;
  private lastResultIsSample = false;
  private splitEvents?: ExtractedSqlResult["logEvents"];
  private appliedSplitPreset?: { name: string; value: string };
  private appliedSqlPreset?: { name: string; value: string };
  private disposableSubscriptions: vscode.Disposable[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);

    this.disposableSubscriptions.push(
      workspace.onDidChangeTextDocument((e) => {
        if (
          this.logParserConfigFileUri &&
          e.document.uri.toString() === this.logParserConfigFileUri.toString()
        ) {
          this.requestPreview(1000);
        }
      })
    );
    this.disposableSubscriptions.push(
      workspace.onDidSaveTextDocument((document) => {
        if (document === this.logParserConfigDoc) {
          void this.resetConfig(true);
        }
      })
    );
    this.disposableSubscriptions.push(
      window.onDidChangeVisibleTextEditors(() => {
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
    const initializationId = ++this.initializationId;
    this.logVersion++;
    this.cancelPreview();
    this.previewError = undefined;
    this.previewKey = undefined;
    this.previewStatus = "idle";
    this.lastResult = undefined;
    this.splitTestKey = undefined;
    this.splitEvents = undefined;
    this.splitSample = undefined;
    this.sqlSample = undefined;
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
    if (initializationId !== this.initializationId) {
      return;
    }
    const logParserConfigItems: LabelValueItem[] = (logParserConfigUris ?? []).map((it) => ({
      label: path.relative(rootPath, it.fsPath),
      value: path.relative(rootPath, it.fsPath),
    }));

    this.totalLogLines = 0;
    this.linesToParse = DEFAULT_SAMPLE_LINES;
    try {
      const rawText = await readResource(logFileUri);
      if (initializationId !== this.initializationId) {
        return;
      }
      this.rawText = rawText;
      this.totalLogLines = this.countLines(this.rawText);
      this.linesToParse = this.totalLogLines > DEFAULT_SAMPLE_LINES ? DEFAULT_SAMPLE_LINES : -1;
    } catch (e) {
      this.rawText = "";
      showWindowErrorMessage(e);
    }
    if (initializationId !== this.initializationId) {
      return;
    }
    this.sampleLinesToParse = this.linesToParse;
    const configurationPayload = this.createConfigurationPayload();
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
          logParserConfigItems,
          linesToParse: this.linesToParse,
          totalLogLines: this.totalLogLines,
          ...configurationPayload,
        },
      },
    };
    this.panel.webview.postMessage(msg);
    this.requestPreview();
  }

  public preDispose(): void {
    this.initializationId++;
    this.disposed = true;
    this.cancelPreview();
    LogParseSettingPanel.currentPanel = undefined;
    this.disposableSubscriptions.forEach((it) => it.dispose());
    this.disposableSubscriptions = [];
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    if (message.command === "cancel") {
      this.dispose();
      return;
    }
    if (message.command !== "ok") {
      return;
    }
    const params = message.params as SaveLogOptionParams;
    const operationId = params.operationId ?? Date.now();
    if (this.activeOperationId !== undefined) {
      this.completeOperation(operationId, "Another operation is still running.");
      return;
    }
    this.activeOperationId = operationId;
    let operationError: string | undefined;
    try {
      const { action, linesToParse, presetName, logParserConfigFile, sqlLanguage } = params;
      this.refreshSampleState();
      switch (action) {
        case "reset-sample-lines":
          if (linesToParse !== undefined) {
            this.sampleLinesToParse = linesToParse;
          }
          this.requestPreview();
          break;
        case "save-config":
          await this.saveConfig();
          break;
        case "copy-config":
        case "create-new-config": {
          if (action === "copy-config" && !this.logParserConfigDoc) {
            throw new Error("Select a config file to copy.");
          }
          const newPath = await this.createLogParserConfigFile(action === "copy-config");
          if (newPath) {
            await this.resetConfigFile(newPath);
            this.requestPreview();
          }
          break;
        }
        case "open-as-json":
          await this.openJsonEditor(true);
          break;
        case "reset-lines":
          if (linesToParse !== undefined) {
            this.linesToParse = linesToParse;
          }
          break;
        case "reset-formatter-sql-language":
          this.formatterSqlLanguage = sqlLanguage;
          this.requestPreview();
          break;
        case "apply-log-event-split-preset":
          if (presetName) {
            await this.applyLogEventSplitPreset(presetName as LogEventSplitPresetName);
            this.requestPreview();
          }
          break;
        case "apply-parser-sql-preset":
          if (presetName) {
            await this.applySqlParsePreset(presetName as SqlLogParsePresetName);
            this.requestPreview();
          }
          break;
        case "parse":
          this.cancelPreview();
          await this.previewTask;
          if (linesToParse !== undefined) {
            this.linesToParse = linesToParse;
          }
          await this.parseLog("sqlExecution");
          break;
        case "set-config-file":
          await this.resetConfigFile(logParserConfigFile);
          this.requestPreview();
          break;
      }
    } catch (error) {
      operationError = error instanceof Error ? error.message : String(error);
    } finally {
      this.activeOperationId = undefined;
      try {
        await this.resetConfig(true);
      } finally {
        this.completeOperation(operationId, operationError);
        if (this.previewPending && !this.previewTimer) {
          this.startPreview();
        }
      }
    }
  }

  private completeOperation(operationId: number, error?: string): void {
    this.panel.webview.postMessage({
      command: "operation-completed",
      componentName: "LogParseSettingPanel",
      value: { "operation-completed": { operationId, error } },
    } satisfies LogParseSettingPanelEventData);
  }

  async resetConfigFile(logParserConfigFile: string | undefined) {
    if (logParserConfigFile) {
      if (!(await existsFileOnWorkspace(logParserConfigFile!))) {
        throw new Error(`Config file does not exist: ${logParserConfigFile}`);
      }
      const wsfolder = workspace.workspaceFolders?.[0].uri;
      if (!wsfolder) {
        return;
      }
      const configUri = Uri.joinPath(wsfolder, logParserConfigFile);
      const document = await workspace.openTextDocument(configUri);
      if (this.logParserConfigFileUri?.toString() !== configUri.toString()) {
        this.clearPreview();
      }
      this.logParserConfigFileUri = configUri;
      this.logParserConfigDoc = document;
    } else {
      this.clearPreview();
      this.logParserConfigFileUri = null;
      this.logParserConfigDoc = null;
    }
    await this.resetConfig(true);
    this.setConfigEditorVisibility();
  }

  async createLogParserConfigFile(copy = false): Promise<string | undefined> {
    const sourceDocument = copy ? this.logParserConfigDoc : undefined;
    const sourceUri = this.logParserConfigFileUri;
    const wsfolder = workspace.workspaceFolders?.[0].uri?.fsPath ?? "";
    const name =
      copy && sourceUri
        ? path.basename(sourceUri.fsPath).replace(/\.log-parser\.config\.json$/, "-copy")
        : path.parse(this.logFileUri?.fsPath ?? "untitled").name;
    let uri: Uri | undefined;
    while (true) {
      uri = await window.showSaveDialog({
        defaultUri: Uri.file(path.join(wsfolder, `${name}.log-parser.config.json`)),
        filters: { logParserConfigJSON: ["log-parser.config.json"] },
        title: copy ? "Copy config and adjust" : "Create log parser config",
      });
      if (!uri) {
        return;
      }
      if (uri.fsPath.endsWith(".log-parser.config.json")) {
        break;
      }
      const retry = await window.showWarningMessage(
        "File name must end with '.log-parser.config.json'. Retry?",
        "Yes",
        "Cancel"
      );
      if (retry !== "Yes") {
        return;
      }
    }
    if (
      uri.toString() === sourceUri?.toString() ||
      workspace.textDocuments.some((doc) => doc.uri.toString() === uri!.toString() && doc.isDirty)
    ) {
      throw new Error("Choose another file to preserve the current edits.");
    }
    const emptyConfig: LogParseConfig = { split: { fields: [] }, classify: [], extractors: [] };
    await writeToResource(uri, sourceDocument?.getText() ?? JSON.stringify(emptyConfig, null, 2));

    const logParserConfigUris = await workspace.findFiles(
      "**/*.log-parser.config.json",
      "**/{node_modules,dist,build,out,coverage,.git,.next,.nuxt,classes}/**"
    );
    const configUris = [...(logParserConfigUris ?? [])];
    if (!configUris.some((item) => item.toString() === uri.toString())) {
      configUris.push(uri);
    }
    const logParserConfigItems: LabelValueItem[] = configUris.map((it) => ({
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
    const preset = LOG_EVENT_SPLIT_PRESETS[presetName];
    if (!preset) {
      throw new Error("Select a log split preset.");
    }
    return preset.split;
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

  private getInputKey(linesToParse = this.linesToParse): string {
    return JSON.stringify([
      this.logVersion,
      this.logFileUri?.toString(),
      this.logParserConfigFileUri?.toString(),
      this.getConfigKey(),
      linesToParse,
      this.formatterSqlLanguage,
    ]);
  }

  private getConfigKey(): string | undefined {
    const text = this.logParserConfigDoc?.getText();
    try {
      return text === undefined ? undefined : stringify(JSON.parse(text));
    } catch {
      return text;
    }
  }

  private getSplitInputKey(config?: LogParseConfig): string {
    return JSON.stringify([
      this.logVersion,
      this.logFileUri?.toString(),
      this.logParserConfigFileUri?.toString(),
      config?.split,
      config?.classify?.filter((rule) => rule?.expandMessage),
      this.sampleLinesToParse,
    ]);
  }

  private refreshSampleState(): void {
    const { configuration } = readLogParseConfiguration(this.logParserConfigDoc?.getText());
    if (!configuration.canSplit) {
      this.splitSample = undefined;
      this.previewKey = undefined;
    }
    if (configuration.availableStage === "split" && this.splitSample?.result.stage === "classify") {
      this.splitSample = undefined;
      this.previewKey = undefined;
    }
    if (!configuration.canParse && this.sqlSample) {
      this.sqlSample = undefined;
      this.previewKey = undefined;
    }
  }

  private async saveConfig(): Promise<void> {
    if (!this.logParserConfigDoc || !(await this.logParserConfigDoc.save())) {
      throw new Error("Could not save the config.");
    }
  }

  private createConfigurationPayload() {
    const { config, configuration, configSummary } = readLogParseConfiguration(
      this.logParserConfigDoc?.getText()
    );
    this.refreshSampleState();
    if (
      this.lastResultKey !==
      this.getInputKey(this.lastResultIsSample ? this.sampleLinesToParse : this.linesToParse)
    ) {
      this.lastResult = undefined;
    }
    const splitTested =
      configuration.canSplit && this.splitTestKey === this.getSplitInputKey(config);
    if (!splitTested) {
      this.splitEvents = undefined;
    }
    if (this.appliedSplitPreset?.value !== JSON.stringify(config?.split)) {
      this.appliedSplitPreset = undefined;
    }
    if (this.appliedSqlPreset?.value !== JSON.stringify([config?.classify, config?.extractors])) {
      this.appliedSqlPreset = undefined;
    }
    const workflow: LogParseWorkflowState = {
      revision: ++this.configurationRevision,
      rawPreview: this.createRawLogResult(this.sampleLinesToParse),
      configuration,
      previewStatus: this.previewStatus,
      previewError: this.previewError,
      configDirty: this.logParserConfigDoc?.isDirty ?? false,
      linesToParse: this.linesToParse,
      setup: {
        sampleLinesToParse: this.sampleLinesToParse,
        split: this.splitSample,
        sql: this.sqlSample,
      },
      result: this.lastResult,
      appliedSplitPreset: this.appliedSplitPreset?.name,
      appliedSqlPreset: this.appliedSqlPreset?.name,
    };
    return {
      configSummary,
      workflow,
      preset: this.createPreset(),
      logParserConfigFile: this.logParserConfigFileUri
        ? path.relative(
            workspace.workspaceFolders?.[0].uri.fsPath ?? "",
            this.logParserConfigFileUri.fsPath
          )
        : "",
    };
  }

  private async resetConfig(postMessage = false): Promise<void> {
    const payload = this.createConfigurationPayload();
    if (postMessage) {
      await this.panel.webview.postMessage({
        command: "reset-config",
        componentName: "LogParseSettingPanel",
        value: { "reset-config": payload },
      } satisfies LogParseSettingPanelEventData);
    }
  }

  private createPreset(): LogParseSettingPanelEventDataPreset {
    const splitConfidence = detectLogSplitPreset(this.rawText, LOG_EVENT_SPLIT_PRESETS);
    const sqlConfidence = this.splitEvents
      ? detectSqlParsePreset(this.splitEvents, SQL_LOG_PARSE_PRESETS)
      : undefined;
    return {
      logSplitDetectionMessage: formatLogDetectionMessage(splitConfidence),
      logEventSplitPresets: Object.entries(LOG_EVENT_SPLIT_PRESETS).map(([name, preset]) => ({
        name,
        label: `${name}${
          splitConfidence.confidence >= 0.3 && splitConfidence.presetNames.includes(name)
            ? " (Recommended)"
            : ""
        }`,
        logExample: preset.logExample,
        logFieldsPattern: createLogEventPatternText({ ...preset.split, targetForHuman: true }),
        logEventSplitPattern: createLogEventPatternText({
          ...preset.split,
          onlyStartMarker: true,
          targetForHuman: true,
        }),
      })),
      sqlParseDetectionMessage: sqlConfidence ? formatLogDetectionMessage(sqlConfidence) : "",
      sqlParsePresets: Object.entries(SQL_LOG_PARSE_PRESETS).map(([name, preset]) => ({
        name,
        label: `${name}${
          sqlConfidence &&
          sqlConfidence.confidence >= 0.3 &&
          sqlConfidence.presetNames.includes(name)
            ? " (Recommended)"
            : ""
        }`,
        classificationSummary: summarizeClassifyRules(preset.classify),
        extractionSummary: summarizeExtractors(preset.extractors),
      })),
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

    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error("Could not apply the split preset.");
    }
    this.appliedSplitPreset = { name: logEventSplitPresetName, value: JSON.stringify(splitConfig) };
  }

  private async applySqlParsePreset(presetName: SqlLogParsePresetName) {
    const document = this.logParserConfigDoc;
    if (!document) {
      return;
    }

    const preset = SQL_LOG_PARSE_PRESETS[presetName];
    if (!preset) {
      throw new Error("Select a SQL preset.");
    }
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

    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error("Could not apply the SQL preset.");
    }
    this.appliedSqlPreset = {
      name: presetName,
      value: JSON.stringify([preset.classify, preset.extractors]),
    };
  }

  private createRawLogResult(linesToParse: number) {
    const rdb = new ResultSetDataBuilder([
      createRdhKey({ name: "lineNo", type: GeneralColumnType.INTEGER, width: 80 }),
      createRdhKey({ name: "content", type: GeneralColumnType.TEXT, width: 1000 }),
    ]);
    const start = new Date().getTime();
    const rawLines = this.rawText
      ? this.rawText.split(/\r?\n|\r/, linesToParse >= 0 ? linesToParse : undefined)
      : [];
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

    rdb.setSqlStatement(this.logFileUri?.fsPath ?? "");
    return rdb.build();
  }

  private showLogParseResultView(
    extractedSqlResult?: ExtractedSqlResult,
    linesToParse = this.linesToParse
  ) {
    const { logFileUri } = this;
    if (!logFileUri) {
      return;
    }
    const commandParams: LogParseResultViewParams = {
      title: path.basename(logFileUri.fsPath),
      rawLogs: this.createRawLogResult(linesToParse),
      totalLogLines: this.totalLogLines,
      linesToParse,
      extractedSqlResult,
    };
    return commands.executeCommand(OPEN_LOG_PARSE_RESULT_VIEWER, commandParams);
  }

  private cancelPreview(): void {
    clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    this.previewPending = false;
    this.previewVersion++;
    this.previewStatus =
      this.sqlSample || this.splitSample
        ? this.previewKey === this.getPreviewInput().key
          ? "ready"
          : "stale"
        : "idle";
  }

  private clearPreview(): void {
    this.cancelPreview();
    this.previewKey = undefined;
    this.previewError = undefined;
    this.splitSample = undefined;
    this.sqlSample = undefined;
    this.splitEvents = undefined;
    this.splitTestKey = undefined;
    this.previewStatus = "idle";
  }

  private getPreviewInput() {
    const { config, configuration } = readLogParseConfiguration(this.logParserConfigDoc?.getText());
    const stage = configuration.availableStage;
    const runConfig =
      config && stage
        ? {
            ...config,
            classify: stage === "split" ? [] : config.classify,
            extractors: stage === "sqlExecution" ? config.extractors : [],
          }
        : undefined;
    const key = stringify([
      this.logVersion,
      this.logFileUri?.toString(),
      this.logParserConfigFileUri?.toString(),
      runConfig,
      stage,
      this.sampleLinesToParse,
      stage === "sqlExecution" ? this.formatterSqlLanguage : undefined,
    ]);
    return { config: runConfig, stage, key };
  }

  private requestPreview(delay = 0): void {
    if (this.disposed) {
      return;
    }
    clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    const { stage, key } = this.getPreviewInput();
    if (!stage) {
      this.cancelPreview();
      this.previewStatus = "idle";
      this.previewError = undefined;
    } else if (key === this.previewKey && !this.previewTask) {
      this.previewPending = false;
      this.previewStatus = this.previewError ? "failed" : "ready";
    } else {
      this.previewVersion++;
      this.previewError = undefined;
      this.previewPending = true;
      this.previewStatus = "waiting";
      if (delay) {
        this.previewTimer = setTimeout(() => {
          this.previewTimer = undefined;
          this.startPreview();
        }, delay);
      } else {
        this.startPreview();
      }
    }
    void this.resetConfig(true);
  }

  private startPreview(): void {
    if (this.disposed || this.previewTask || this.activeOperationId !== undefined) {
      return;
    }
    this.previewPending = false;
    this.previewTask = this.updatePreview().finally(() => {
      this.previewTask = undefined;
      if (this.previewPending && !this.previewTimer) {
        this.startPreview();
      }
    });
  }

  private async updatePreview(): Promise<void> {
    const { stage, key } = this.getPreviewInput();
    if (!stage) {
      return;
    }
    if (key === this.previewKey) {
      this.previewStatus = this.previewError ? "failed" : "ready";
      await this.resetConfig(true);
      return;
    }
    const version = this.previewVersion;
    this.previewStatus = "running";
    await this.resetConfig(true);
    try {
      if (version !== this.previewVersion) {
        return;
      }
      await this.parseLog(stage, true, version);
      if (version === this.previewVersion) {
        this.previewStatus = "ready";
      }
    } catch (error) {
      if (version === this.previewVersion) {
        this.previewStatus = "failed";
        this.previewError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (version === this.previewVersion) {
        this.previewKey = key;
        await this.resetConfig(true);
      }
    }
  }

  private async parseLog(
    stage: LogParseRunState["stage"],
    sample = false,
    version = this.previewVersion
  ): Promise<void> {
    const linesToParse = sample ? this.sampleLinesToParse : this.linesToParse;
    const currentInputKey = () =>
      this.getInputKey(sample ? this.sampleLinesToParse : this.linesToParse);
    const inputKey = currentInputKey();
    const run: LogParseRunState = {
      status: "failed",
      sample,
      stage,
      logName: path.basename(this.logFileUri?.fsPath ?? ""),
      linesToParse,
      eventCount: 0,
      sqlCount: 0,
    };
    try {
      const { config, configuration } = readLogParseConfiguration(
        this.logParserConfigDoc?.getText()
      );
      if (!config) {
        throw new Error(configuration.splitError || "Select a config file.");
      }
      if (!(sample ? configuration.availableStage : configuration.canParse)) {
        throw new Error(
          (stage === "split" ? configuration.splitError : configuration.parseError) ||
            "Configure the log split fields."
        );
      }
      const runConfig = sample ? this.getPreviewInput().config! : config;
      const result = await new LogParser(runConfig).parse({
        logText: this.rawText,
        stage,
        language: this.formatterSqlLanguage,
        linesToParse,
      });
      if (sample && (version !== this.previewVersion || inputKey !== currentInputKey())) {
        return;
      }
      if (!sample && inputKey !== currentInputKey()) {
        throw new Error("Settings changed. Parse the log again.");
      }
      if (!result.ok) {
        throw new Error(result.error || "Log parsing failed.");
      }
      if (!sample) {
        await this.showLogParseResultView(result, linesToParse);
      }
      if (sample && (version !== this.previewVersion || inputKey !== currentInputKey())) {
        return;
      }
      if (!sample && inputKey !== currentInputKey()) {
        throw new Error("Settings changed. Parse the log again.");
      }
      run.status = "success";
      run.eventCount = result.logEvents.length;
      run.sqlCount = result.sqlExecutions.length;
      run.diagnostics = result.diagnostics;
      if (sample) {
        const preview =
          stage !== "sqlExecution"
            ? createLogResultBuilder(result.logEvents, stage).build()
            : createSqlResultBuilder(result.sqlExecutions).build();
        const classifiedPreview =
          stage !== "split" ? createLogResultBuilder(result.logEvents, stage).build() : undefined;
        const sampleState = {
          result: run,
          preview,
          classifiedPreview,
        };
        if (stage !== "sqlExecution") {
          this.splitSample = sampleState;
        } else {
          this.sqlSample = sampleState;
        }
        this.splitTestKey = result.logEvents.length ? this.getSplitInputKey(config) : undefined;
        this.splitEvents = result.logEvents;
      }
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (inputKey === currentInputKey() && (!sample || version === this.previewVersion)) {
        this.lastResultIsSample = sample;
        this.lastResultKey = inputKey;
        this.lastResult = run;
      }
    }
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
