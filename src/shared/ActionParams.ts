import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import type { ModeType } from "./ModeType";
import type { ERDiagramSettingParams } from "./ERDiagram";
import type { CodeResolverParams } from "./CodeResolverParams";
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

export type SaveValuesParams = TabIdParam & SaveValuesInRdhParams;

export type OutputParams = TabIdParam & {
  fileType: "excel" | "csv" | "markdown" | "text";
  outputWithType: "none" | "withComment" | "withType" | "both";
  withRowNo?: boolean;
  displayOnlyChanged?: boolean;
};

export type ActionCommand =
  | CancelActionCommand
  | CompareActionCommand
  | CreateERDiagramActionCommand
  | CreateCodeResolverEditorActionCommand
  | SaveCompareKeysActionCommand
  | OutputActionCommand
  | WriteToClipboardActionCommand
  | OpenScanPanelActionCommand
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

export type SaveValuesActionCommand = {
  command: "saveValues";
  params: SaveValuesParams;
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
  outputWithType: "none" | "withComment" | "withType" | "both";
  withRowNo: boolean;
  withCodeLabel: boolean;
  limit?: number; // default:10
  specifyDetail?: boolean;
  options?: T;
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

export type CloseScanPanelActionCommand = {
  command: "closeScanPanel";
  params: TabIdParam;
};

export type SearchScanPanelParams = {
  tabId: string;
  keyword: string;
  limit?: number;
  startTime?: any;
  endTime?: any;
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
