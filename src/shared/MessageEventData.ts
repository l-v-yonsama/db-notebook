import type {
  ConnectionSetting,
  DBType,
  DbResource,
  DbSchema,
  DbTable,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { ContentTypeInfo, DiffResult, RdhKey, ResultSetData } from "@l-v-yonsama/rdh";
import type { Har } from "har-format";
import type { ExtChartData, ExtChartOptions, PairPlotChartParams } from "../shared/ExtChartJs";
import type { CellMeta, CellMetaChart } from "../types/Notebook";
import type {
  NameWithComment,
  SaveCsvOptionParams,
  SearchScanPanelParams,
  WriteHttpEventToClipboardParams,
} from "./ActionParams";
import type { CodeResolverParams } from "./CodeResolverParams";
import type { ComponentName } from "./ComponentName";
import type { ModeType } from "./ModeType";
import type { RecordRule } from "./RecordRule";
import type { NodeRunAxiosEvent } from "./RunResultMetadata";

export type MessageEventData =
  | MdhViewEventData
  | CountRecordViewEventData
  | ChartsViewEventData
  | HttpEventPanelEventData
  | CreateInsertScriptSettingsPanelEventData
  | CsvParseSettingPanelEventData
  | HarFilePanelEventData
  | DiffMdhViewEventData
  | ScanPanelEventData
  | ViewConditionPanelEventData
  | VariablesPanelEventData
  | WriteHttpEventToClipboardParamsPanelEventData
  | NotebookCellMetadataPanelEventData
  | ERDiagramSettingsPanelEventData
  | RecordRuleEditorEventData
  | CodeResolverEditorEventData
  | DBFormEventData;

export type BaseMessageEventDataCommand = "stop-progress" | "loading" | "initialize";

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

export type HttpResponseTabItem = {
  tabId: string;
  title: string;
  list: NodeRunAxiosEvent[];
};

export type HarFileTabItem = {
  tabId: string;
  title: string;
  res: Har;
  rdh: ResultSetData;
};

export type MdhViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "init",
  "MdhView",
  {
    searchResult?: {
      tabId: string;
      value: ResultSetData[];
    };
    addTabItem?: RdhTabItem;
    init?: {
      tabItems: RdhTabItem[];
      currentTabId?: string;
      currentInnerIndex?: number;
    };
  }
>;

export type HttpEventPanelEventCodeBlocks = {
  req: {
    headers?: string;
    params?: string;
    contents?: string;
    previewContentTypeInfo?: ContentTypeInfo;
    cookies?: ResultSetData;
  };
  res: {
    headers?: string;
    contents?: string;
    previewContentTypeInfo?: ContentTypeInfo;
    cookies?: ResultSetData;
  };
};

export type CreateInsertScriptSettingsPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-preview-sql",
  "CreateInsertScriptSettingsPanel",
  {
    initialize?: {
      tableRes: DbTable;
      previewSql: string;
      assignSchemaName?: boolean;
      onlyNotNullColumns?: boolean;
      withComments?: boolean;
      compactSql?: boolean;
      langType: "sql" | "javascript";
      numOfRecords: number;
    };
    setPreviewSql?: {
      previewSql: string;
    };
  }
>;

export type HttpEventPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "HttpEventPanel",
  {
    loading?: number;
    initialize?: {
      title: string;
      value: NodeRunAxiosEvent;
      codeBlocks: HttpEventPanelEventCodeBlocks;
    };
  }
>;

export type HarFilePanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-response" | "add-tab-item",
  "HarFilePanel",
  {
    searchResponse?: {
      tabId: string;
      value: {
        res: Har;
        rdh: ResultSetData;
      };
    };
    addTabItem?: HarFileTabItem;
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
  comparable: boolean;
  undoable: boolean;
  hasUndoChangeSql: boolean;
  list: DiffTabInnerItem[];
};

export type DiffMdhViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "init",
  "DiffMdhView",
  {
    searchResult?: {
      tabId: string;
      value: DiffTabItem;
    };
    addTabItem?: DiffTabItem;
    init?: {
      tabItems: DiffTabItem[];
      currentTabId?: string;
      currentInnerIndex?: number;
    };
  }
>;

export type ChartTabItem = {
  tabId: string;
  title: string;
  type: CellMetaChart["type"];
  data?: ExtChartData;
  options?: ExtChartOptions;
  pairPlotChartParams?: PairPlotChartParams;
};

export type ScanConditionItem = {
  label: string;
  value: any;
  visible: boolean;
  description?: string;
  items?: {
    label: string;
    value: string;
  }[];
};

export type ScanTabItem = {
  tabId: string;
  conName: string;
  resourceType: ScanConditionItem;
  prevResourceTypeValue?: ResourceType;
  rootRes: DbResource;
  title: string;
  dbType: DBType;
  rdh?: any;
  limit: ScanConditionItem;
  jsonExpansion: ScanConditionItem;
  keyword: ScanConditionItem;
  startDt: ScanConditionItem;
  endDt: ScanConditionItem;
  multilineKeyword: boolean;
  parentTarget?: string;
  targetName: string;
  lastSearchParam?: SearchScanPanelParams;
};

// export type ScanReqInput = {
//   tabId: string;
//   keyword: string;
//   limit?: number;
//   startTime?: number;
//   endTime?: number;
// };

export type ScanPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "remove-tab-item",
  "ScanPanel",
  {
    searchResult?: {
      tabId: string;
      value: ResultSetData;
      resourceType: ResourceType;
    };
    addTabItem?: ScanTabItem;
    removeTabItem?: {
      tabId: string;
    };
  }
>;

export type ViewConditionPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-preview-sql" | "set-rdh-for-update",
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
    rdhForUpdate?: ResultSetData;
  }
>;

export type CsvParseSettingPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-preview-rdh",
  "CsvParseSettingPanel",
  {
    initialize?: SaveCsvOptionParams;
    rdh: ResultSetData | null;
    message?: string;
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

export type WriteHttpEventToClipboardParamsPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "WriteHttpEventToClipboardParamsPanel",
  {
    initialize?: {
      params: WriteHttpEventToClipboardParams;
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
      columnItems: RdhKey[];
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

export type CountRecordViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "refresh",
  "CountRecordView",
  {
    refresh: {
      schemaRes: DbSchema;
      selectedTableNames: string[];
      mode: "setting" | "running" | "show";
      rdh?: ResultSetData;
    };
  }
>;

export type ChartsViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "init",
  "ChartsView",
  {
    searchResult?: {
      tabId: string;
      value: ChartTabItem;
    };
    addTabItem?: ChartTabItem;
    init?: {
      tabItems: ChartTabItem[];
      currentTabId?: string;
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
