import type {
  ConnectionSetting,
  ResourceType,
  CsvParseOptions,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { ModeType } from "./ModeType";
import type { ERDiagramSettingParams } from "./ERDiagram";
import type { CodeResolverParams } from "./CodeResolverParams";
import type { SaveValuesInRdhParams } from "./SaveValuesInRdhParams";
import type { CellMeta } from "../types/Notebook";

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
  | CreateERDiagramActionCommand
  | CreateCodeResolverEditorActionCommand
  | CreateUndoChangeSqlActionCommand
  | CreateRequestScriptActionCommand
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
  | TestConnectionSettingActionCommand
  | SaveConnectionSettingActionCommand
  | SaveValuesActionCommand
  | ShowErrorActionCommand
  | DeleteKeyActionCommand
  | UpdateTextDocumentActionCommand
  | UpdateCodeResolverTextDocumentActionCommand
  | CountAllTablesActionCommand
  | OkActionCommand;

export type NameWithComment = {
  name: string;
  comment?: string;
};

export type BaseActionCommand<T extends string, U = any> = {
  command: T;
  params: U;
};

export type ShowErrorActionCommand = BaseActionCommand<"showError", { message: string }>;

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
