import type {
  ConnectionSetting,
  CsvParseOptions,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { CellMeta } from "../types/Notebook";
import type { CodeResolverParams } from "./CodeResolverParams";
import type { ERDiagramSettingParams } from "./ERDiagram";
import type { ModeType } from "./ModeType";
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

export type OutputParams = TabIdParam & {
  fileType: "excel" | "csv" | "markdown" | "text" | "html";
  displayOnlyChanged?: boolean;
};

export type ActionCommand =
  | CancelActionCommand
  | CompareActionCommand
  | ConnectActionCommand
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
  | ShowErrorActionCommand
  | DeleteKeyActionCommand
  | UpdateTextDocumentActionCommand
  | UpdateCodeResolverTextDocumentActionCommand
  | CountAllTablesActionCommand
  | OkActionCommand
  | ReadyActionCommand
  | SubscribeActionCommand
  | UnsubscribeActionCommand
  | ExecuteActionCommand
  | KillActionCommand;

export type NameWithComment = {
  name: string;
  comment?: string;
};

export type BaseActionCommand<T extends string, U = any> = {
  command: T;
  params: U;
};

export type ShowErrorActionCommand = BaseActionCommand<"showError", { message: string }>;

export type KillActionCommand = BaseActionCommand<"kill", { sessionOrPid: number | undefined }>;

export type ConnectActionCommand = BaseActionCommand<"connect", { conName: string }>;
export type DisconnectActionCommand = BaseActionCommand<"disconnect", { conName: string }>;
export type SubscribeActionCommand = BaseActionCommand<"subscribe", { subscriptionName: string }>;
export type UnsubscribeActionCommand = BaseActionCommand<
  "unsubscribe",
  { subscriptionName: string }
>;

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
  params: ConnectionSetting;
};

export type CancelActionCommand = BaseActionCommand<"cancel">;

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
        | "save-code-item"
        | "delete-code-item"
        | "duplicate-code-item";
      detail?: any;
    };
    scrollPos: number;
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
