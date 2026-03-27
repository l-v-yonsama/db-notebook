import type {
  ConnectionSetting,
  DBType,
  DbDynamoTable,
  DbResource,
  DbSchema,
  DbTable,
  ExtractedSqlResult,
  LogParseParams,
  MqttQoS,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  ContentTypeInfo,
  DiffResult,
  RdhKey,
  ResultSetData,
  ToStringParam,
} from "@l-v-yonsama/rdh";
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
import type { DBDumpInputParams, DBDumpSettingsUIParams } from "./DBDumpParams";
import type { DBRestoreInputParams, DBRestoreSettingsUIParams } from "./DBRestoreParams";
import type { DynamoQueryFilter } from "./DynamoDBConditionParams";
import type { LabelValueItem } from "./LabelValueItem";
import type { ModeType } from "./ModeType";
import type { RecordRule } from "./RecordRule";
import type { NodeRunAxiosEvent } from "./RunResultMetadata";

export type MessageEventData =
  | ChartsViewEventData
  | Chat2QueryPanelEventData
  | CodeResolverEditorEventData
  | CountRecordViewEventData
  | CreateInsertScriptSettingsPanelEventData
  | CsvParseSettingPanelEventData
  | DBFormEventData
  | DBDumpSettingsPanelEventData
  | DBRestoreSettingsPanelEventData
  | DiffMdhViewEventData
  | DynamoQueryPanelEventData
  | ERDiagramSettingsPanelEventData
  | HarFilePanelEventData
  | HttpEventPanelEventData
  | LMPromptCreatePanelEventData
  | LogParseSettingPanelEventData
  | LogParseResultViewEventData
  | MdhViewEventData
  | PublishEditorPanelEventData
  | SubscriptionPayloadsViewEventData
  | NotebookCellMetadataPanelEventData
  | RecordRuleEditorEventData
  | ScanPanelEventData
  | SubscriptionSettingPanelEventData
  | ToolsViewEventData
  | VariablesPanelEventData
  | ViewConditionPanelEventData
  | WriteHttpEventToClipboardParamsPanelEventData;

export type BaseMessageEventDataCommand = "stop-progress" | "loading" | "initialize";

export type BaseMessageEventData<T, U = ComponentName, V = any> = {
  command: T;
  componentName: U;
  value: V;
};

export type RdhViewConfig = {
  dateFormat: ToStringParam["dateFormat"];
  timestampFormat: ToStringParam["timestampFormat"];
  binaryToHex: ToStringParam["binaryToHex"];
  displayComment: boolean;
  displayType: boolean;
  hideRowColumn?: boolean;
};

export type LogParsedTabItem = {
  tabId: string;
  title: string;
  totalLogLines: number;
  linesToParse: number;
  rawLogs: ResultSetData;
  logEvents?: ResultSetData;
  sqlEvents?: ResultSetData;
  list: ResultSetData[];
  extractedSqlResult?: ExtractedSqlResult;
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
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "initialize",
  "MdhView",
  {
    searchResult?: {
      tabId: string;
      value: ResultSetData[];
    };
    addTabItem?: RdhTabItem;
    initialize?: {
      tabItems: RdhTabItem[];
      currentTabId?: string;
      currentInnerIndex?: number;
    };
    config?: RdhViewConfig;
  }
>;

export type LogParseResultViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "initialize",
  "LogParseResultView",
  {
    searchResult?: {
      tabId: string;
      value: ResultSetData[];
      extractedSqlResult?: LogParsedTabItem["extractedSqlResult"];
    };
    addTabItem?: Omit<LogParsedTabItem, "rawLogs" | "logEvents" | "sqlEvents">;
    initialize?: {
      tabItems: Omit<LogParsedTabItem, "rawLogs" | "logEvents" | "sqlEvents">[];
      currentTabId?: string;
      currentInnerIndex?: number;
    };
    config?: RdhViewConfig;
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

export type DynamoQueryPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-preview-input",
  "DynamoQueryPanel",
  {
    initialize?: {
      tableRes: DbDynamoTable;
      previewInput: string;
      numOfRows: number;
      limit: number;
      pkName: string;
      skName: string;
      pkValue: string;
      skValue: string;
      pkAttr: string;
      skAttr: string;
      skOpe: string;
      target: string;
      sortDesc: boolean;
      filters: DynamoQueryFilter[];
      columnItems: { value: string | number; label: string }[];
    };
    setPreviewInput?: {
      previewInput: string;
    };
  }
>;

export type PublishEditorPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-preview-input" | "change-status",
  "PublishEditorPanel",
  {
    initialize?: {
      conName: string;
      subscriptionName: string;
      langType: "plain" | "json" | "javascript";
      numOfPayloads: number;
    };
    changeStatus?: {
      connected: boolean;
    };
    setPreviewInput?: {
      previewInput: string;
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
    config: RdhViewConfig;
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
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "initialize",
  "DiffMdhView",
  {
    searchResult?: {
      tabId: string;
      value: DiffTabItem;
    };
    addTabItem?: DiffTabItem;
    initialize?: {
      tabItems: DiffTabItem[];
      currentTabId?: string;
      currentInnerIndex?: number;
    };
    config?: RdhViewConfig;
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

export type SubscriptionSettingPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "SubscriptionSettingPanel",
  {
    initialize?: {
      name: string;
      qos: MqttQoS;
      nl: boolean;
      rap: boolean;
      rh: number;
      isNew: boolean;
      allTopicNames: string[];
    };
  }
>;

export type ViewConditionPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-preview-sql" | "set-rdh-for-update",
  "ViewConditionPanel",
  {
    initialize?: {
      tableRes: DbTable | DbDynamoTable;
      limit: number;
      numOfRows: number;
      previewSql: string;
      supportEditMode: boolean;
      numOfRowsLabel: string;
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
    config: RdhViewConfig;
  }
>;

export type LogParseSettingPanelEventDataConfigSummary = {
  logEventSplitPattern: string;
  classificationSummary: string;
  extractionSummary: string;
};

export type LogParseSettingPanelEventDataPreset = {
  logSplitDetectionMessage: string;
  logEventSplitPresets: {
    name: string;
    label: string;
    logExample: string;
    logFieldsPattern: string;
  }[];
  sqlParseDetectionMessage: string;
  sqlParsePresets: LabelValueItem[];
};

export type LogParseSettingPanelEventData = BaseMessageEventData<
  | BaseMessageEventDataCommand
  | "reset-raw-log"
  | "reset-config"
  | "set-parsed-result"
  | "set-config-editor-visibility"
  | "set-sql-parse-preset-visibility"
  | "reset-config-file-and-items",
  "LogParseSettingPanel",
  {
    "initialize"?: {
      logParserConfigFile: string;
      logParserConfigItems: LabelValueItem[];
      formatterSqlLanguage: LogParseParams["language"];
      formatterSqlLanguageItems: LabelValueItem[];
      linesToParse: number;
      totalLogLines: number;
      errorMessage: string;
      configSummary: LogParseSettingPanelEventDataConfigSummary;
      preset: LogParseSettingPanelEventDataPreset;
    };
    "reset-config-file-and-items"?: {
      logParserConfigFile: string;
      logParserConfigItems: LabelValueItem[];
    };
    "reset-config"?: {
      configSummary: LogParseSettingPanelEventDataConfigSummary;
      canSplitLog: boolean;
      errorMessage: string;
      preset: LogParseSettingPanelEventDataPreset;
    };
    "set-config-editor-visibility"?: boolean;
    "set-sql-parse-preset-visibility"?: boolean;
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
      preparationVisible: boolean;
      connectionSettingNames: string[];
      codeFileItems: LabelValueItem[];
      ruleFileItems: LabelValueItem[];
      columnItems: RdhKey[];
    };
  }
>;

export type LMPromptCreatePanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-prompts",
  "LMPromptCreatePanel",
  {
    initialize?: {
      errorMessage: string;
      hasExplainPlan: boolean;
      assistantPromptText: string;
      userPromptText: string;
      languageModels: LabelValueItem[];
      languageModelId: string;
      translateResponse: boolean;
      withTableDefinition: boolean;
      withRetrievedExecutionPlan: boolean;
    };
    setPrompts?: {
      assistantPromptText: string;
      userPromptText: string;
    };
  }
>;

export type Chat2QueryPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-prompts" | "set-results",
  "Chat2QueryPanel",
  {
    initialize?: {
      allTables: DbTable[];
      selectedTableNames: string[];
      assistantPromptText: string;
      userPromptText: string;
      languageModels: LabelValueItem[];
      languageModelId: string;
      queryContent: string;
      translateResponse: boolean;
      withTableDefinition: boolean;
      withSampleData: boolean;
      errorMessage: string;
      screenMode: "setting" | "generating" | "generated";
    };
    setPrompts?: {
      assistantPromptText: string;
      userPromptText: string;
    };
    setResult?: {
      screenMode: "setting" | "generating" | "generated";
      elapsedTime: string;
      modelName: string;
      explanation: string;
      queryText: string;
      errorMessage: string;
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

/* =========================
 * Dump
 * ========================= */

export type DBDumpSettingsPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "DBDumpSettingsPanel",
  {
    initialize?: {
      params: DBDumpInputParams;
      uiParams: DBDumpSettingsUIParams;
    };
  }
>;

/* =========================
 * Restore
 * ========================= */

export type DBRestoreSettingsPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "DBRestoreSettingsPanel",
  {
    initialize?: {
      params: DBRestoreInputParams;
      uiParams: DBRestoreSettingsUIParams;
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

export type ToolsViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "refresh",
  "ToolsView",
  {
    refresh: {
      mode: "sessions" | "locks";
      rdh?: ResultSetData;
    };
  }
>;

export type ChartsViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "initialize",
  "ChartsView",
  {
    searchResult?: {
      tabId: string;
      value: ChartTabItem;
    };
    addTabItem?: ChartTabItem;
    initialize?: {
      tabItems: ChartTabItem[];
      currentTabId?: string;
    };
  }
>;

export type SubscriptionPayloadsViewEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "set-search-result" | "add-tab-item" | "initialize",
  "SubscriptionPayloadsView",
  {
    searchResult?: {
      isSubscribed: boolean;
      rdh: ResultSetData | null;
    };
    initialize?: {
      subscriptionName: string;
      isSubscribed: boolean;
      rdh: ResultSetData | null;
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
      isDirty: boolean;
      keyword: string;
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
  selectedFilePath?: string;
  targetAttribute?: string;
};

export type DBFormEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "selectedFile",
  "DBFormView",
  DBFormEventDataValue
>;
