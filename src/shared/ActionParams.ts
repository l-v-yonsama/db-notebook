import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import type { ModeType } from "./ModeType";

export type ActionCommandType =
  | "openScanPanel"
  | "closeScanPanel"
  | "search"
  | "output"
  | "refresh"
  | "compare"
  | "closeTab"
  | "selectTab"
  | "selectInnerTab"
  | "testConnectionSetting"
  | "saveConnectionSetting"
  | "deleteKey";

export type TabIdParam = {
  tabId: string;
};

export type CompareParams = TabIdParam & {
  base?: "before" | "after";
};

export type OutputParams = TabIdParam & {
  fileType: "excel" | "csv" | "markdown" | "text";
  outputWithType: "none" | "withComment" | "withType" | "both";
  displayOnlyChanged?: boolean;
};

export type ActionCommand =
  | CompareActionCommand
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
  | DeleteKeyActionCommand;

export type TestConnectionSettingActionCommand = {
  command: "testConnectionSetting";
  params: ConnectionSetting;
};

export type SaveConnectionSettingActionCommand = {
  command: "saveConnectionSetting";
  mode: ModeType;
  params: ConnectionSetting;
};

export type CompareActionCommand = {
  command: "compare";
  params: CompareParams;
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

export type WriteToClipboardParams = TabIdParam & {
  fileType: "csv" | "markdown" | "text";
  outputWithType: "none" | "withComment" | "withType" | "both";
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
