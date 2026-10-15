import dayjs from "dayjs";
import * as path from "node:path";
import {
  compareSqlExecutions, type ExtractedSqlResult, type LogSqlComparisonOptions,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  env, Memento, ProgressLocation, RelativePattern, Uri, ViewColumn, WebviewPanel, window, workspace,
} from "vscode";
import { EXTENSION_NAME } from "../constant";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webview/webviewUtil";
import {
  runSqlLogComparison,
  SqlLogComparisonCancelled,
} from "../utilities/sqlLogComparison/runComparison";

const COMPONENT = "SqlLogComparisonPanel";
const PARSER_HISTORY_KEY = `${EXTENSION_NAME}-sql-log-parser-config-history`;
const EQUIVALENCE_OPTIONS_KEY = `${EXTENSION_NAME}-sql-log-comparison-equivalence-options`;
const PARSER_HISTORY_LIMIT = 50;
const PARSER_GLOBS = ["*.log-parser.config.json", "*/*.log-parser.config.json", "*/*/*.log-parser.config.json"];
const EXCLUDE = "**/{node_modules,dist,build,out,coverage,.git,.next,.nuxt,classes}/**";
type FileField = "beforeFile" | "afterFile" | "beforeParserConfigFile" | "afterParserConfigFile" | "outputDirectory";
type FormOptions = { dialect: LogSqlComparisonOptions["dialect"]; equivalence?: LogSqlComparisonOptions["equivalence"] };
type Message = { command: "ready" | "run" | "preview" | "openReport" | "pick" | "swap" | "close" | "selectParserConfig"; field?: FileField; uri?: string; options?: FormOptions; revision?: number };

const PREVIEW_BEFORE_SQL = "SELECT /*+ MAX_EXECUTION_TIME(5000) */ T1_.ID FROM orders T1_ WHERE (T1_.Created_At < CURRENT_TIMESTAMP AND T1_.Updated_At = '2026-10-12 10:01:00.123') /* note */ ORDER BY T1_.ID";
const PREVIEW_AFTER_SQL = "SELECT id FROM orders WHERE created_at < NOW() AND updated_at = '2026-10-12 10:02:00.456' ORDER BY id";

function previewExtraction(sql: string): ExtractedSqlResult {
  return {
    ok: true,
    stage: "sqlExecution",
    logEvents: [],
    sqlExecutions: [{ startLine: 1, endLine: 1, comparisonSql: sql, sourceRanges: [{ startLine: 1, endLine: 1 }] }],
    inputSummary: {} as ExtractedSqlResult["inputSummary"],
    outputSummary: {} as ExtractedSqlResult["outputSummary"],
    elapsedTimeMilli: { split: 0, total: 0 },
  };
}

export class SqlLogComparisonPanel {
  private static current?: SqlLogComparisonPanel;
  private readonly files: Partial<Record<FileField, Uri>> = {};
  private readonly parserChoices = new Map<string, Uri>();
  private readonly parserHistory: Map<string, string>;
  private outputDirectoryPicked = false;
  private lastReport?: Uri;
  private running = false;

  private constructor(private readonly panel: WebviewPanel, private readonly extensionVersion: string, extensionUri: Uri, private readonly storage: Memento) {
    this.parserHistory = new Map(storage.get<[string, string][]>(PARSER_HISTORY_KEY, []));
    panel.webview.html = createWebviewContent(panel.webview, extensionUri, COMPONENT);
    panel.webview.onDidReceiveMessage(async (message: Message) => this.handle(message));
    panel.onDidDispose(() => { SqlLogComparisonPanel.current = undefined; });
  }

  static show(extensionUri: Uri, extensionVersion: string, storage: Memento, uri?: Uri, selectedUris?: Uri[]): void {
    const existing = this.current;
    if (!this.current) {
      const panel = window.createWebviewPanel("sqlLogComparison", "SQL Log Comparison", ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [Uri.joinPath(extensionUri, "webview-ui/build")],
      });
      this.current = new SqlLogComparisonPanel(panel, extensionVersion, extensionUri, storage);
    } else {
      this.current.panel.reveal(ViewColumn.One);
    }
    this.current.setSelectedLogs(uri, selectedUris);
    if (existing) {
      void this.current.refreshParserChoices().catch((error) => this.current?.status(String(error), "error"));
    }
  }

  private post(value: Record<string, unknown>): void {
    void this.panel.webview.postMessage({ command: "update", componentName: COMPONENT, value });
  }

  private status(message: string, kind: "info" | "error" | "success" = "info"): void {
    this.post({ type: "status", message, kind });
  }

  private resetReport(): void {
    this.lastReport = undefined;
    this.post({ type: "reportReady", ready: false });
  }

  private restoreParserConfig(logField: "beforeFile" | "afterFile"): void {
    const configField = logField === "beforeFile" ? "beforeParserConfigFile" : "afterParserConfigFile";
    const logFile = this.files[logField];
    const configPath = logFile && this.parserHistory.get(logFile.fsPath);
    this.files[configField] = configPath ? Uri.file(configPath) : undefined;
  }

  private async rememberParserConfigs(): Promise<void> {
    for (const [logField, configField] of [
      ["beforeFile", "beforeParserConfigFile"],
      ["afterFile", "afterParserConfigFile"],
    ] as const) {
      const logFile = this.files[logField];
      const configFile = this.files[configField];
      if (!logFile || !configFile) { continue; }
      this.parserHistory.delete(logFile.fsPath);
      this.parserHistory.set(logFile.fsPath, configFile.fsPath);
    }
    while (this.parserHistory.size > PARSER_HISTORY_LIMIT) {
      this.parserHistory.delete(this.parserHistory.keys().next().value!);
    }
    await this.storage.update(PARSER_HISTORY_KEY, [...this.parserHistory]);
  }

  private setSelectedLogs(uri?: Uri, selectedUris?: Uri[]): void {
    if (this.running) { return; }
    const selected = [...new Map((selectedUris?.length ? selectedUris : uri ? [uri] : []).map((item) => [item.toString(), item])).values()];
    if (selected.length > 2) {
      this.status("Select up to two log files.", "error");
      return;
    }
    if (selected.length) {
      this.resetReport();
      this.files.beforeFile = selected[0];
      this.files.afterFile = selected[1];
      this.restoreParserConfig("beforeFile");
      this.restoreParserConfig("afterFile");
      this.outputDirectoryPicked = false;
      delete this.files.outputDirectory;
      this.setDefaultOutputDirectory();
    }
    this.sendFiles();
  }

  private setDefaultOutputDirectory(): void {
    if (!this.outputDirectoryPicked) {
      this.files.outputDirectory = this.files.beforeFile?.scheme === "file"
        ? Uri.file(path.dirname(this.files.beforeFile.fsPath))
        : undefined;
    }
  }

  private sendFiles(): void {
    const paths = Object.fromEntries(Object.entries(this.files).map(([key, uri]) => [key, uri?.fsPath]));
    const uris = Object.fromEntries(Object.entries(this.files).map(([key, uri]) => [key, uri?.toString()]));
    this.post({ type: "files", paths, uris });
  }

  private async refreshParserChoices(): Promise<void> {
    const folders = workspace.workspaceFolders ?? [];
    const found = (await Promise.all(folders.flatMap((folder) =>
      PARSER_GLOBS.map((glob) => workspace.findFiles(new RelativePattern(folder, glob), EXCLUDE))
    ))).flat();
    const selected = [this.files.beforeParserConfigFile, this.files.afterParserConfigFile].filter((uri): uri is Uri => !!uri);
    this.parserChoices.clear();
    for (const uri of [...found, ...selected]) { this.parserChoices.set(uri.toString(), uri); }
    const choices = [...this.parserChoices.values()].map((uri) => {
      const folder = workspace.getWorkspaceFolder(uri);
      return { value: uri.toString(), label: folder ? `${folder.name}/${path.relative(folder.uri.fsPath, uri.fsPath)}` : uri.fsPath };
    });
    this.post({ type: "parserChoices", choices });
  }

  private async handle(message: Message): Promise<void> {
    try {
      if (message.command === "ready") {
        this.sendFiles();
        await this.refreshParserChoices();
        const equivalence = this.storage.get<LogSqlComparisonOptions["equivalence"]>(EQUIVALENCE_OPTIONS_KEY);
        this.post({ type: "equivalenceOptions", equivalence });
        this.preview({ dialect: "mysql", equivalence }, 0);
        return;
      }
      if (message.command === "preview" && message.options) {
        if (this.running) { return; }
        this.resetReport();
        this.preview(message.options, message.revision ?? 0);
        if (message.options.equivalence) {
          await this.storage.update(EQUIVALENCE_OPTIONS_KEY, message.options.equivalence);
        }
        return;
      }
      if (message.command === "close") { this.panel.dispose(); return; }
      if (message.command === "swap") {
        if (this.running) { return; }
        [this.files.beforeFile, this.files.afterFile] = [this.files.afterFile, this.files.beforeFile];
        [this.files.beforeParserConfigFile, this.files.afterParserConfigFile] = [this.files.afterParserConfigFile, this.files.beforeParserConfigFile];
        this.setDefaultOutputDirectory();
        this.resetReport();
        this.sendFiles();
        return;
      }
      if (message.command === "pick" && message.field) { await this.pick(message.field); return; }
      if (message.command === "selectParserConfig" && message.field && (message.field === "beforeParserConfigFile" || message.field === "afterParserConfigFile")) {
        if (this.running) { return; }
        this.files[message.field] = message.uri ? this.parserChoices.get(message.uri) : undefined;
        this.resetReport();
        this.sendFiles();
        return;
      }
      if (message.command === "openReport" && this.lastReport) { await env.openExternal(this.lastReport); return; }
      if (message.command === "run" && message.options) { await this.run(message.options); }
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error), "error");
    }
  }

  private preview(options: LogSqlComparisonOptions, revision: number): void {
    const dateFunction = options.dialect === "transactsql" ? "GETDATE()"
      : options.dialect === "sqlite" || options.dialect === "plsql" ? "CURRENT_TIMESTAMP" : "NOW()";
    const result = compareSqlExecutions({
      before: previewExtraction(PREVIEW_BEFORE_SQL),
      after: previewExtraction(PREVIEW_AFTER_SQL.replace("NOW()", dateFunction)),
      options,
    });
    this.post({
      type: "preview", revision,
      preview: {
        status: result.details[0].sqlMatchLevel,
        beforeSql: result.before[0].equivalentSql,
        afterSql: result.after[0].equivalentSql,
        diffText: result.details[0].diffEquivalentText,
      },
    });
  }

  private async pick(field: FileField): Promise<void> {
    if (this.running) { return; }
    const directory = field === "outputDirectory";
    const selected = await window.showOpenDialog({
      title: directory ? "Select output folder" : field.includes("Parser") ? "Select parser config" : "Select log file",
      canSelectFiles: !directory,
      canSelectFolders: directory,
      canSelectMany: false,
      defaultUri: directory ? this.files.outputDirectory : undefined,
      ...(!directory && field.includes("Parser") ? { filters: { JSON: ["json"] } } : {}),
    });
    const picked = selected?.[0];
    if (!picked) { return; }
    this.files[field] = picked;
    if (field === "beforeFile" || field === "afterFile") { this.restoreParserConfig(field); }
    if (field === "beforeFile") { this.setDefaultOutputDirectory(); }
    if (field === "outputDirectory") { this.outputDirectoryPicked = true; }
    if (field.includes("Parser") || field === "beforeFile" || field === "afterFile") { await this.refreshParserChoices(); }
    this.resetReport();
    this.sendFiles();
  }

  private async run(options: FormOptions): Promise<void> {
    if (this.running) { return; }
    const { beforeFile, afterFile, beforeParserConfigFile, afterParserConfigFile, outputDirectory } = this.files;
    if (!beforeFile || !afterFile || !beforeParserConfigFile || !afterParserConfigFile || !outputDirectory) {
      this.status("Select both logs, parser configs and an output folder.", "error");
      return;
    }
    if (outputDirectory.scheme !== "file") {
      this.status("Select a local output folder.", "error");
      return;
    }
    const outputFile = Uri.file(path.join(outputDirectory.fsPath, `sql-log-comparison-${dayjs().format("YYYYMMDD-HHmmss-SSS")}.xlsx`));
    this.running = true;
    this.resetReport();
    this.post({ type: "running", running: true });
    try {
      const result = await window.withProgress({ location: ProgressLocation.Notification, title: "Comparing SQL logs", cancellable: true }, (progress, token) =>
        runSqlLogComparison({
          beforeFile, afterFile, outputFile,
          settings: { beforeParserConfigFile, afterParserConfigFile, ...options },
          extensionVersion: this.extensionVersion,
          token,
          report: (step) => { progress.report({ message: step }); this.status(step); },
        })
      );
      this.lastReport = outputFile;
      try { await this.rememberParserConfigs(); }
      catch (error) { log(`Could not save SQL log parser history: ${String(error)}`); }
      const { formattedMatched, equivalentMatched, unmatched, skipped } = result.summary;
      this.status(`Saved: formatted ${formattedMatched}, equivalent ${equivalentMatched}, different ${unmatched}, review ${skipped}`, "success");
      this.post({ type: "reportReady", ready: true });
    } catch (error) {
      this.status(error instanceof SqlLogComparisonCancelled ? "Cancelled." : error instanceof Error ? error.message : String(error), error instanceof SqlLogComparisonCancelled ? "info" : "error");
    } finally {
      this.running = false;
      this.post({ type: "running", running: false });
    }
  }
}
