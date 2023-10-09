import type {
  ConnectionSetting,
  DBType,
  DbResource,
  DbSchema,
  DbTable,
  DiffResult,
  ResultSetData,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { ComponentName } from "./ComponentName";
import type { ModeType } from "./ModeType";
import type { NameWithComment, WriteToClipboardParams } from "./ActionParams";
import type { RecordRule } from "./RecordRule";
import type { CodeResolverParams } from "./CodeResolverParams";
import type { CellMeta } from "../types/Notebook";
import type { SQLRunResultMetadata } from "./SQLRunResultMetadata";

export type MessageEventData =
  | MdhPanelEventData
  | DiffPanelEventData
  | ScanPanelEventData
  | ViewConditionPanelEventData
  | VariablesPanelEventData
  | WriteToClipboardParamsPanelEventData
  | NotebookCellMetadataPanelEventData
  | ERDiagramSettingsPanelEventData
  | RecordRuleEditorEventData
  | CodeResolverEditorEventData
  | DBFormEventData;

export type BaseMessageEventDataCommand = "stop-progress" | "initialize";

export type BaseMessageEventData<T, U = ComponentName, V = any> = {
  command: T;
  componentName: U;
  value: V;
};

export type RdhTabItem = {
  tabId: string;
  title: string;
  refreshable: boolean;
  list: ResultSetData[];
};

export type MdhPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item",
  "MdhPanel",
  {
    searchResult?: {
      tabId: string;
      value: ResultSetData[];
    };
    addTabItem?: RdhTabItem;
  }
>;

export type DiffTabInnerItem = {
  tabId: string;
  title: string;
  rdh1: ResultSetData;
  rdh2: ResultSetData;
  diffResult: DiffResult;
  undoChangeStatements?: string[];
};

export type DiffTabItem = {
  tabId: string;
  title: string;
  subTitle: string;
  hasUndoChangeSql: boolean;
  list: DiffTabInnerItem[];
};

export type DiffPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item",
  "DiffPanel",
  {
    searchResult?: {
      tabId: string;
      value: DiffTabItem;
    };
    addTabItem?: DiffTabItem;
  }
>;

export type ScanConditionItem = {
  label: string;
  value: any;
  visible: boolean;
  description?: string;
};

export type ScanTabItem = {
  tabId: string;
  conName: string;
  rootRes: DbResource;
  title: string;
  dbType: DBType;
  rdh?: any;
  limit: ScanConditionItem;
  keyword: ScanConditionItem;
  startDt: ScanConditionItem;
  endDt: ScanConditionItem;
  multilineKeyword: boolean;
  parentTarget?: string;
  lastSearchParam?: ScanReqInput;
};

export type ScanReqInput = {
  tabId: string;
  keyword: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
};

export type ScanPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "remove-tab-item",
  "ScanPanel",
  {
    searchResult?: {
      tabId: string;
      value: ResultSetData;
    };
    addTabItem?: ScanTabItem;
    removeTabItem?: {
      tabId: string;
    };
  }
>;

export type ViewConditionPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-preview-sql",
  "ViewConditionPanel",
  {
    initialize?: {
      tableRes: DbTable;
      limit: number;
      numOfRows: number;
      previewSql: string;
    };
    setPreviewSql?: {
      previewSql: string;
    };
  }
>;

export type VariablesPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "VariablesPanel",
  {
    initialize?: {
      variables: ResultSetData;
    };
  }
>;

export type WriteToClipboardParamsPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "WriteToClipboardParamsPanel",
  {
    initialize?: {
      params: WriteToClipboardParams;
      previewText: string;
    };
  }
>;

export type NotebookCellMetadataPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "NotebookCellMetadataPanel",
  {
    initialize?: {
      metadata: CellMeta;
      connectionSettingNames: string[];
      codeFileItems: { label: string; value: string }[];
      ruleFileItems: { label: string; value: string }[];
    };
  }
>;

export type ERDiagramSettingsInputParams = {
  title: string;
  tables: DbTable[];
  selectedTable?: DbTable;
};

export type ERDiagramSettingsPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "ERDiagramSettingsPanel",
  {
    initialize?: {
      params: ERDiagramSettingsInputParams;
    };
  }
>;

export type RecordRuleEditorEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "RecordRuleEditor",
  {
    initialize?: {
      connectionSettingNames: string[];
      schema?: DbSchema;
      recordRule: RecordRule;
      scrollPos: number;
    };
  }
>;

export type CodeResolverEditorEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "CodeResolverEditor",
  {
    initialize?: {
      connectionSettingNames: string[];
      tableNameList: NameWithComment[];
      columnNameList: NameWithComment[];
      resolver: CodeResolverParams;
      scrollPos: number;
    };
  }
>;

export type DBFormEventDataValue = {
  subComponentName: "ConnectionSetting" | "ResourceProperties";
  connectionSetting?: {
    mode: ModeType;
    setting: ConnectionSetting;
    prohibitedNames: string[];
  };
  resourceProperties?: {
    [key: string]: any;
  };
};

export type DBFormEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "DBFormView",
  DBFormEventDataValue
>;
