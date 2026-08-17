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
  PerformanceTuningContext,
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
import type { QueryStatisticsViewState } from "./QueryStatisticsParams";
import type { RecordRule } from "./RecordRule";
import type { NodeRunAxiosEvent } from "./RunResultMetadata";

export type MessageEventData =
  | ChartsViewEventData
  | Chat2QueryPanelEventData
  | CfnDiagramSettingsPanelEventData
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
  | PerformanceTuningPreviewPanelEventData
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
  /**
   * Pre-formatted environment label (e.g. "PRODUCTION") for the connection the result came
   * from, resolved host-side (the webview has no StateStorage access). Undefined when the
   * connection has no `environment` set -- never guessed.
   */
  environment?: string;
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
  matchType: ScanConditionItem;
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
  logEventFieldsPattern: string;
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
    logEventSplitPattern: string;
  }[];
  sqlParseDetectionMessage: string;
  sqlParsePresets: {
    name: string;
    label: string;
    classificationSummary: string;
    extractionSummary: string;
  }[];
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

// Beginner-facing view of one group of same-cause PerformanceTuningDiagnostic
// entries (or, for the warning severity, of UnavailableSection entries) -
// built once, extension-side, by buildPerformanceTuningDiagnosticGroups()
// (src/utilities/performanceTuningDiagnosticFormatter.ts) so the Vue
// component never hand-rolls per-code copy or grouping itself
// (misc/design/performance-tuning-context-implementation-plan.ja.md §4.4/§10 Phase 5).
// Declared here (not in that utility file) since both the extension host
// (which builds it) and the webview (which only renders it) need the shape.
export type PerformanceTuningDiagnosticDetailViewModel = {
  nodeId?: string;
  operation?: string;
  objectName?: string;
  schemaName?: string;
  tableName?: string;
  // Always present, even when every other field above is - a detail row
  // with no node/object identity must still show *something* (§4.4: "object
  // 名が取得できない場合もnode IDとoperationは必ず表示する" generalizes to
  // "never a blank row").
  technicalMessage: string;
};

export type PerformanceTuningDiagnosticGroupViewModel = {
  key: string;
  severity: "info" | "warning";
  title: string;
  summary: string;
  suggestedAction?: string;
  details: PerformanceTuningDiagnosticDetailViewModel[];
};

export type PerformanceTuningPreviewPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "PerformanceTuningPreviewPanel",
  {
    initialize?: {
      context: PerformanceTuningContext;
      // Grouped/summarized once, extension-side, from
      // context.collection.diagnostics + .unavailableSections - see
      // PerformanceTuningDiagnosticGroupViewModel above. Ordered
      // information-first, in the same provenance order collection.diagnostics
      // itself has (plan-level, then per-table); the Vue component splits by
      // severity for the Information vs. Collection issues sections but does
      // not itself re-sort or re-derive anything.
      diagnosticGroups: PerformanceTuningDiagnosticGroupViewModel[];
      // Pre-rendered by createCodeHtmlString() (Prism, extension-side) so the
      // webview can just v-html them - mirrors HttpEventPanel's codeBlocks.
      sqlHtml: string;
      jsonHtml: string;
      // Computed on the extension side (Buffer.byteLength) rather than
      // re-serialized/measured in the webview, so the displayed number
      // always matches what RDSBaseDriver.enforcePayloadBudget() itself saw.
      payloadBytes: number;
      maxPayloadBytes: number;
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
  /** Names of tables pre-checked when the panel opens - one name from a table-row entry point,
   * every table's name from a schema-row entry point. */
  selectedTableNames?: string[];
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

/** Entry points are the CloudFormation service node (every stack pre-selected) or one or more
 * selected stacks (just those pre-selected) - either way, `stacks` always lists every stack
 * under the connection so the panel can freely add/remove from the initial selection. */
export type CfnDiagramSettingsInputParams = {
  conName: string;
  stacks: { name: string; status: string }[];
  initialSelectedStackNames: string[];
};

export type CfnDiagramSettingsPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand,
  "CfnDiagramSettingsPanel",
  {
    initialize?: {
      params: CfnDiagramSettingsInputParams;
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
    // sessions/locks keep their original minimal shape (RDH is the only
    // state, and search happens over the base DbResource that opened them).
    // queryStatistics carries QueryStatisticsViewState in full on every
    // update - including a preview-status-only change - so the webview
    // never has to reconcile a partial patch against state it already holds
    // (misc/design/performance-tuning-context-implementation-plan.ja.md §10 Phase 5).
    refresh:
      | { mode: "sessions" | "locks"; rdh?: ResultSetData }
      | ({ mode: "queryStatistics" } & QueryStatisticsViewState);
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
    setting: ConnectionSetting & { mcpEnabled?: boolean };
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
