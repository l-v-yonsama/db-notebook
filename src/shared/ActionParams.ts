import type {
  ConnectionSetting,
  CsvParseOptions,
  ERDiagramSettingParams,
  LogParseParams,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { CellMeta } from "../types/Notebook";
import type { CfnDiagramGenerateParams } from "./CfnDiagram";
import type { CodeResolverParams } from "./CodeResolverParams";
import type { ModeType } from "./ModeType";
import type { QueryStatisticsSearchParams } from "./QueryStatisticsParams";
import type { SaveValuesInRdhParams } from "./SaveValuesInRdhParams";

export type TabIdParam = {
  tabId: string;
};

export type CompareParams = TabIdParam & {
  base?: "before" | "after";
};

export type SaveCompareKeysParams = TabIdParam & {
  list: { index: number; compareKeyNames: string[] }[];
};

export type SaveCsvOptionParams = CsvParseOptions & {
  preview: boolean;
};

export type SaveLogOptionParams = {
  action:
    | "create-new-config"
    | "reset-lines"
    | "reset-formatter-sql-language"
    | "apply-log-event-split-preset"
    | "apply-parser-sql-preset"
    | "open-as-json"
    | "parse"
    | "test-split"
    | "set-config-file";
  linesToParse?: number;
  presetName?: string;
  logParserConfigFile?: string;
  sqlLanguage?: LogParseParams["language"];
};

export type OutputParams = TabIdParam & {
  fileType: "excel" | "csv" | "markdown" | "text" | "html";
  displayOnlyChanged?: boolean;
};

export type ActionCommand =
  | CancelActionCommand
  | InputChangeActionCommand
  | ShowMessageActionCommand
  | CompareActionCommand
  | ConnectActionCommand
  | CreateCfnDiagramActionCommand
  | CreateERDiagramActionCommand
  | CreateCodeResolverEditorActionCommand
  | CreateUndoChangeSqlActionCommand
  | CreateRequestScriptActionCommand
  | DisconnectActionCommand
  | SaveCompareKeysActionCommand
  | SaveNotebookCellMetadataActionCommand
  | OutputActionCommand
  | WriteToClipboardActionCommand
  | WriteHttpEventToClipboardActionCommand
  | DescribeActionCommand
  | OpenInNoteBookActionCommand
  | OpenScanPanelActionCommand
  | OpenInEditorActionCommand
  | CloseScanPanelActionCommand
  | SearchScanPanelActionCommand
  | RefreshPanelActionCommand
  | CloseTabActionCommand
  | SelectTabActionCommand
  | SelectInnerTabActionCommand
  | SelectFileActionCommand
  | TestConnectionSettingActionCommand
  | SaveConnectionSettingActionCommand
  | SaveValuesActionCommand
  | DeleteKeyActionCommand
  | CopyAwsSecretValueActionCommand
  | UpdateTextDocumentActionCommand
  | UpdateKeywordActionCommand
  | UpdateCodeResolverTextDocumentActionCommand
  | CountAllTablesActionCommand
  | OkActionCommand
  | ReadyActionCommand
  | SubscribeActionCommand
  | UnsubscribeActionCommand
  | ExecuteActionCommand
  | KillActionCommand
  | SearchQueryStatisticsActionCommand
  | SelectQueryStatisticsRowActionCommand
  | PreviewPerformanceTuningActionCommand
  | AnalyzePerformanceTuningWithAiActionCommand
  | SaveAiAnalysisAsNotebookActionCommand;

export type NameWithComment = {
  name: string;
  comment?: string;
};

export type BaseActionCommand<T extends string, U = any> = {
  command: T;
  params: U;
};

export type ShowMessageActionCommand = BaseActionCommand<
  "showMessage",
  {
    type?: "info" | "warn" | "error";

    message: string;
  }
>;

export type KillActionCommand = BaseActionCommand<"kill", { sessionOrPid: number | undefined }>;

// Query Statistics mode only (ToolsView.vue). Sent by the explicit
// Search/Refresh action (or Enter), never on every keystroke - the webview
// owns the form fields; the extension host is the source of truth for
// clamping/defaulting them (misc/design/performance-tuning-context-implementation-plan.ja.md
// §10 Phase 5: "入力変更だけでは検索せず...最終的なclampは引き続きDriverの責務とする").
export type SearchQueryStatisticsActionCommand = BaseActionCommand<
  "searchQueryStatistics",
  Partial<QueryStatisticsSearchParams>
>;

// Sent when the user clicks a Query Statistics row (ToolsView.vue's
// onClickCell), so ToolsViewProvider can compute that row's Bind Parameters
// estimate (misc/design/performance-tuning-query-statistics-parameter-input-plan.ja.md
// §7.1/§7.5). Same resultVersion + rowIndex re-resolution as
// PreviewPerformanceTuningActionCommand below, for the same reason.
export type SelectQueryStatisticsRowActionCommand = BaseActionCommand<
  "selectQueryStatisticsRow",
  { resultVersion: number; rowIndex: number }
>;

// Starts a performance tuning context preview from a selected Query
// Statistics row. Deliberately carries only `resultVersion` + `rowIndex`,
// never the row's own values - ToolsViewProvider re-resolves
// `rdh.rows[rowIndex].values` itself from the version it still holds, so a
// compromised/buggy webview can't substitute arbitrary SQL/statistics into
// the collected context (§10 Phase 5 "行選択とworkload変換"). `values` is
// the user's own input for each Bind Parameters row (always strings - §7.4
// of the parameter-input-plan doc above), and `markers` is the matching
// placeholder text ToolsViewProvider itself produced for that row via
// selectQueryStatisticsRow (echoed back, not re-derived by the webview) -
// both are same-length, same-order arrays, validated on both ends, and
// never persisted past this one collection attempt.
export type PreviewPerformanceTuningActionCommand = BaseActionCommand<
  "previewPerformanceTuning",
  { resultVersion: number; rowIndex: number; values: unknown[]; markers: unknown[] }
>;

// Step 10 (misc/design/performance-tuning-structured-ai-analysis-plan.ja.md
// §6.1). PerformanceTuningPreviewPanel already holds the
// PerformanceTuningContext it rendered as instance state (the same context
// PreviewPerformanceTuningActionCommand's caller already had `driver.
// getPerformanceTuningContext()` build), so the only things the webview
// needs to send are the two live AI-options selections it owns (2026-08-19
// follow-up, model/translate picker) - deliberately not persisted host-side
// across previews (unlike Chat2QueryPanel.ts's "ok"-on-every-change/instance-
// state pattern), since this panel already resets all AI state on every new
// preview anyway.
export type AnalyzePerformanceTuningWithAiActionCommand = BaseActionCommand<
  "analyzePerformanceTuningWithAi",
  { languageModelId: string; translateResponse: boolean }
>;

// Saves the most recent successful AI analysis (held as Panel instance
// state, same reasoning as above) as a new Notebook under
// reports/performance-tuning/ (§8). No params for the same reason.
export type SaveAiAnalysisAsNotebookActionCommand = BaseActionCommand<"saveAiAnalysisAsNotebook">;

export type ConnectActionCommand = BaseActionCommand<"connect", { conName: string }>;
export type DisconnectActionCommand = BaseActionCommand<"disconnect", { conName: string }>;
export type SubscribeActionCommand = BaseActionCommand<"subscribe", { subscriptionName: string }>;
export type UnsubscribeActionCommand = BaseActionCommand<
  "unsubscribe",
  { subscriptionName: string }
>;
export type UpdateKeywordActionCommand = BaseActionCommand<"updateKeyword", { keyword: string }>;

export type SelectFileActionCommand = BaseActionCommand<
  "selectFileActionCommand",
  {
    targetAttribute: string;
    /**
     * Allow to select files, defaults to `true`.
     */
    canSelectFiles?: boolean;

    /**
     * Allow to select folders, defaults to `false`.
     */
    canSelectFolders?: boolean;

    /**
     * Allow to select many files or folders.
     */
    canSelectMany?: boolean;

    /**
     * A set of file filters that are used by the dialog. Each entry is a human-readable label,
     * like "TypeScript", and an array of extensions, for example:
     * ```ts
     * {
     * 	'Images': ['png', 'jpg'],
     * 	'TypeScript': ['ts', 'tsx']
     * }
     * ```
     */
    filters?: { [name: string]: string[] };
    /**
     * Dialog title.
     */
    title?: string;
  }
>;

export type TestConnectionSettingActionCommand = {
  command: "testConnectionSetting";
  params: ConnectionSetting;
};

export type SaveConnectionSettingActionCommand = {
  command: "saveConnectionSetting";
  mode: ModeType;
  params: ConnectionSetting & { mcpEnabled?: boolean };
};

export type CancelActionCommand = BaseActionCommand<"cancel">;

export type InputChangeActionCommand<U = any> = BaseActionCommand<"inputChange", U>;

export type OkActionCommand = BaseActionCommand<"ok">;

export type ReadyActionCommand = BaseActionCommand<"ready">;

export type ExecuteActionCommand = BaseActionCommand<"execute">;

export type UpdateTextDocumentActionCommand = BaseActionCommand<
  "updateTextDocument",
  {
    newText: string;
    values?: {
      name:
        | "cancel"
        | "change"
        | "add-rule"
        | "edit-rule"
        | "delete-rule"
        | "save-rule"
        | "duplicate-rule";
      detail?: any;
    };
    scrollPos: number;
  }
>;

export type CountAllTablesActionCommand = BaseActionCommand<
  "countAllTables",
  {
    selectedTableNames: string[];
  }
>;

export type UpdateCodeResolverTextDocumentActionCommand = BaseActionCommand<
  "updateCodeResolverTextDocument",
  {
    newText: string;
    values?: {
      name:
        | "cancel"
        | "change"
        | "add-code-item"
        | "edit-code-item"
        | "move-code-item"
        | "save-code-item"
        | "delete-code-item"
        | "duplicate-code-item";
      detail?: any;
    };
    scrollPos: number;
    save?: boolean;
    openAsJson?: boolean;
    keyword: string;
  }
>;

export type CompareActionCommand = {
  command: "compare";
  params: CompareParams;
};

export type CreateERDiagramActionCommand = BaseActionCommand<
  "createERDiagram",
  ERDiagramSettingParams
>;

export type CreateCfnDiagramActionCommand = BaseActionCommand<
  "createCfnDiagram",
  CfnDiagramGenerateParams
>;

export type CreateCodeResolverEditorActionCommand = BaseActionCommand<
  "createCodeResolverEditor",
  {
    connectionSettingNames: string[];
    tableNameList: NameWithComment[];
    columnNameList: NameWithComment[];
    resolver: CodeResolverParams;
    scrollPos: number;
  }
>;

export type SaveCompareKeysActionCommand = {
  command: "saveCompareKeys";
  params: SaveCompareKeysParams;
};

export type SaveNotebookCellMetadataActionCommand = BaseActionCommand<
  "saveNotebookCellMetadata",
  {
    metadata: CellMeta;
  }
>;

export type CreateUndoChangeSqlActionCommand = BaseActionCommand<"createUndoChangeSql", TabIdParam>;

export type CreateRequestScriptActionCommand = BaseActionCommand<"createRequestScript">;

export type SaveValuesActionCommand = {
  command: "saveValues";
  params: SaveValuesInRdhParams;
};

export type DeleteKeyActionCommand = {
  command: "DeleteKey";
  params: TabIdParam & {
    key: string;
  };
};

// Fetches the real (decrypted) value of an SSM parameter / Secrets Manager
// secret on demand and writes it directly to the clipboard from the
// extension host. The value is deliberately never included in this message
// or sent back to the webview - see AwsSsmServiceClient#scan() /
// AwsSecretsManagerServiceClient#scan(), which never fetch it either.
export type CopyAwsSecretValueActionCommand = {
  command: "copyAwsSecretValue";
  params: TabIdParam & {
    name: string;
  };
};
export type OutputActionCommand = {
  command: "output";
  params: OutputParams;
};

export type WriteToClipboardActionCommand = {
  command: "writeToClipboard";
  params: WriteToClipboardParams;
};

export type WriteToClipboardParams<T = any> = TabIdParam & {
  fileType: "csv" | "tsv" | "markdown" | "text";
  textContent?: string;
  options?: T;
};

export type WriteHttpEventToClipboardActionCommand = {
  command: "writeHttpEventToClipboard";
  params: WriteHttpEventToClipboardParams;
};

export type WriteHttpEventToClipboardParams = {
  fileType: "markdown" | "text";
  withRequest: boolean;
  withResponse: boolean;
  withCookies: boolean;
  withBase64: boolean;
  limitCell?: number; // default:1000
  specifyDetail?: boolean;
};

export type OpenScanPanelParams = {
  parentTabId: string;
  logGroupName: string;
  logStream: string;
  startTime: string;
};

export type OpenScanPanelActionCommand = {
  command: "openScanPanel";
  params: OpenScanPanelParams;
};

export type OpenInEditorActionCommand = {
  command: "openInEditor";
  params: {};
};

export type CloseScanPanelActionCommand = {
  command: "closeScanPanel";
  params: TabIdParam;
};

export type SearchScanPanelParams = {
  tabId: string;
  keyword: string;
  limit?: number;
  jsonExpansion?: boolean;
  startTime?: any;
  endTime?: any;
  resourceType: ResourceType;
  matchType?: "exact" | "partial";
  execComparativeProcess?: boolean;
};

export type SearchScanPanelActionCommand = {
  command: "search";
  params: SearchScanPanelParams;
};

export type RefreshPanelActionCommand = {
  command: "refresh";
  params: TabIdParam;
};

export type CloseTabActionCommand = {
  command: "closeTab";
  params: TabIdParam;
};

export type SelectTabActionCommand = {
  command: "selectTab";
  params: TabIdParam;
};

export type SelectInnerTabActionCommand = {
  command: "selectInnerTab";
  params: TabIdParam & {
    innerIndex: number;
  };
};

export type DescribeActionCommand = {
  command: "describe";
  params: TabIdParam & {
    innerIndex: number;
  };
};

export type OpenInNoteBookActionCommand = {
  command: "openInNoteBook";
  params: TabIdParam;
};
