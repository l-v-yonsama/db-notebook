import type { LogParseWorkflowState } from "./LogParseWorkflow";
import type {
  CapabilityStatus,
  ConnectionSetting,
  DBType,
  DbDynamoTable,
  DbResource,
  DbSchema,
  DbTable,
  DynamoDbPerformanceTuningContext,
  EstimatedBindParameter,
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
import type {
  DynamoQueryBuildMode,
  DynamoQueryFilter,
  DynamoQueryProjectionConstraintView,
  DynamoQueryProjectionMode,
} from "./DynamoDBConditionParams";
import type { DynamoDbPerformanceTuningHumanSummary } from "./DynamoDbPerformanceTuningHumanSummary";
import type { LabelValueItem } from "./LabelValueItem";
import type { ModeType } from "./ModeType";
import type {
  PerformanceTuningAiAnalysisResult,
  PerformanceTuningAiTokenUsage,
} from "./PerformanceTuningAiAnalysis";
import type {
  BaselineSourceInfo,
  ComparisonAiInputDetail,
  PerformanceTuningComparisonEvidence,
} from "./PerformanceTuningComparison";
import type { AiMaskingLevel, PreparedAiPayload } from "./AiDataMasking";
import type { PerformanceTuningHumanSummary } from "./PerformanceTuningHumanSummary";
import type { QueryStatisticsViewState } from "./QueryStatisticsParams";
import type { RecordRule } from "./RecordRule";
import type { NodeRunAxiosEvent } from "./RunResultMetadata";
import type { CloudWatchDashboardHostMessage } from "./observability";

export type MessageEventData =
  | CloudWatchDashboardHostMessage
  | ChartsViewEventData
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
  | LogParseSettingPanelEventData
  | LogParseResultViewEventData
  | MdhViewEventData
  | PublishEditorPanelEventData
  | SubscriptionPayloadsViewEventData
  | NotebookCellMetadataPanelEventData
  | PerformanceTuningPreviewPanelEventData
  | AiDataMaskingPreviewPanelEventData
  | PerformanceTuningBindParametersPanelEventData
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

export type AiDataMaskingPreviewPanelEventData = BaseMessageEventData<
  "initialize" | "ai-send-preview" | "ai-send-preview-closed",
  "AiDataMaskingPreviewPanel",
  {
    aiSendPreview?: PreparedAiPayload;
    aiSendPreviewClosedRequestId?: string;
  }
>;

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
      projectionMode: DynamoQueryProjectionMode;
      projectedAttributes: string[];
      consistentRead: boolean;
      buildMode: DynamoQueryBuildMode;
      projectionConstraint: DynamoQueryProjectionConstraintView;
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
  | "operation-completed"
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
      workflow: LogParseWorkflowState;
      configSummary: LogParseSettingPanelEventDataConfigSummary;
      preset: LogParseSettingPanelEventDataPreset;
    };
    "reset-config-file-and-items"?: {
      logParserConfigFile: string;
      logParserConfigItems: LabelValueItem[];
    };
    "reset-config"?: {
      configSummary: LogParseSettingPanelEventDataConfigSummary;
      logParserConfigFile: string;
      workflow: LogParseWorkflowState;
      preset: LogParseSettingPanelEventDataPreset;
    };
    "set-config-editor-visibility"?: boolean;
    "operation-completed"?: { operationId: number; error?: string };
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

// User-facing diagnostic groups are built extension-side and rendered by the
// webview. The shared shape lives here for both sides.
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

// Built once, extension-side, by buildPlanTableMappingRows()
// (src/performanceTuning/report/performanceTuningPlanFormatter.ts) from
// PerformanceTuningContext.planTableMappings - see that file's top comment
// for why the tree (normalizedPlan) and this flat per-table array get two
// different renderers. Declared here for the same reason as the diagnostic
// view models above - both the extension host and the webview need the shape.
export type PlanTableMappingRowViewModel = {
  table: string;
  index?: string;
  estimatedRows?: number;
  // See PlanTableMappingRow's own comment in performanceTuningPlanFormatter.ts -
  // populated only when analyze-mode runtime rows can be safely resolved.
  actualRows?: number;
  rowEstimateRatio?: number;
  tableAccessFraction?: number;
  predicateFilterSelectivity?: number;
  columnsUsed?: string;
};

// Built once, extension-side, by buildDynamoDbAccessPatternViewModel()
// (src/performanceTuning/report/dynamoDbPerformanceTuningAccessPatternFormatter.ts) from
// DynamoDbPerformanceTuningContext.accessPattern - the DynamoDB counterpart
// of PlanTableMappingRowViewModel above (RDB has no equivalent structure to
// share this with; DynamoDB access patterns are a genuinely different shape,
// see that context type's own top comment). Purely presentational text -
// every source field is already value-free, so this view model is too.
export type DynamoDbAccessPatternViewModel = {
  operationLabel: string;
  accessPathLabel: string;
  confidence: "certain" | "unknown";
  targetRef: string;
  partitionKeyText: string;
  sortKeyText?: string;
  postReadFilterText: string;
  projectionText: string;
  consistentReadLabel: string;
  apiLimitText?: string;
  resultItemLimitText?: string;
  scanDirectionLabel?: string;
};

// A tagged status prevents independently optional AI fields from becoming
// inconsistent. Saving does not discard a successful analysis.
export type PerformanceTuningAiAnalysisViewState = {
  status: "idle" | "running" | "success" | "error";
  result?: PerformanceTuningAiAnalysisResult;
  // Preflight estimate for the request being sent, or the smallest attempted
  // request when fitting failed. A successful result persists the same data
  // under result.request.tokenUsage for Notebook reproducibility.
  tokenUsage?: PerformanceTuningAiTokenUsage;
  contextDetail?: "full" | "compact";
  comparisonDetail?: ComparisonAiInputDetail;
  errorMessage?: string;
  // Only set when status is "error" and the failure was a JSON.parse()
  // failure on the model's own reply - kept so a malformed response is never
  // silently discarded, only ever shown collapsed (§11).
  rawResponseText?: string;
  savedNotebookRelativePath?: string;
};

/**
 * Tagged baseline comparison state for the Preview.
 *
 * Every section of the comparison renders from `evidence` alone, with no AI
 * involved - "AI 分析前から全セクションを表示可能にする" (§12).
 */
export type PerformanceTuningComparisonViewState = {
  status: "idle" | "loading" | "ready" | "error";
  // Both set together whenever status is "ready".
  baseline?: BaselineSourceInfo;
  evidence?: PerformanceTuningComparisonEvidence;
  // A load/selection failure. The previous selection is deliberately kept on
  // screen when this happens, so a mistaken pick never silently drops a
  // working comparison (§17.5).
  errorMessage?: string;
  // True when an AI analysis result currently on screen was produced under a
  // different baseline than the one now selected. The Preview must then say
  // so rather than presenting the old text as an analysis of the new
  // comparison (§12).
  analysisStale?: boolean;
};

// Common to both engines' AI/full-JSON shell fields (2026-08-24 follow-up,
// DynamoDB support) - factored out only to avoid repeating these fields' doc
// comments twice, not exposed/used as a type on its own anywhere else.
type PerformanceTuningPreviewShellFields = {
  // Baseline comparison (§12). Always present, `status: "idle"` when no
  // baseline has been selected - the section then renders as the
  // "Compare with Baseline..." affordance alone.
  comparison: PerformanceTuningComparisonViewState;
  // Pre-rendered by createCodeHtmlString() (Prism, extension-side) so the
  // webview can just v-html them - mirrors HttpEventPanel's codeBlocks.
  jsonHtml: string;
  // Computed on the extension side (Buffer.byteLength) rather than
  // re-serialized/measured in the webview. This is retained as diagnostic
  // metadata under the collapsed Full context JSON details; model fit is
  // communicated with model-specific token usage instead.
  payloadBytes: number;
  maxPayloadBytes: number;
  // Analyze with AI's model/response-language options (2026-08-19 follow-up)
  // - populated directly from
  // lm.selectChatModels({vendor: "copilot"}) mapped 1:1, no filtering),
  // except defaultLanguageModelId carries no gpt-4o-family preference (see
  // lmModelSelection.ts). English UI locales omit the response-language
  // checkbox and force translateResponse false; other locales default it on.
  languageModels: LabelValueItem[];
  languageModelId: string;
  translateResponse: boolean;
  translateResponseLabel?: string;
  maskingLevel: AiMaskingLevel;
};

// RDB view model (2026-08-24 follow-up: split out of the formerly-flat
// `initialize` shape so a DynamoDB sibling could be added below without
// forcing RDB-only fields like planTreeText/queryDiagram* to become
// meaningless-when-absent on a DynamoDB payload too). `engine` is a
// view-model-only discriminant - PerformanceTuningContext itself has no such
// field (see isDynamoDbPerformanceTuningContext()'s own doc comment for why).
export type RelationalPerformanceTuningInitializeViewModel = PerformanceTuningPreviewShellFields & {
  engine: "relational";
  context: PerformanceTuningContext;
  // Grouped/summarized once, extension-side, from
  // context.collection.diagnostics + .unavailableSections - see
  // PerformanceTuningDiagnosticGroupViewModel above. Ordered
  // information-first, in the same provenance order collection.diagnostics
  // itself has (plan-level, then per-table); the Vue component splits by
  // severity for the Information vs. Collection issues sections but does
  // not itself re-sort or re-derive anything.
  diagnosticGroups: PerformanceTuningDiagnosticGroupViewModel[];
  // Execution plan display (2026-08-19 follow-up). planTreeText is
  // undefined when executionPlan.normalizedPlan itself is absent
  // (e.g. a Provider that hasn't wired it, or SQLite); an empty
  // planTableMappingRows array is normal (a plan can legitimately touch
  // zero tables) and just means that sub-section doesn't render.
  planTreeText?: string;
  // XML runtime artifacts (currently SQL Server's SET STATISTICS XML)
  // are indented extension-side for display only. The exact raw artifact
  // remains in context.executionPlan.actualPlan / Full Context JSON.
  actualPlanDisplayText?: string;
  planTableMappingRows: PlanTableMappingRowViewModel[];
  // Deterministic, human-readable facts built once by the extension host.
  humanSummary: PerformanceTuningHumanSummary;
  // Mermaid itself is intentionally not bundled into the Preview webview.
  // The saved DBN/HTML report contains the query-scoped diagram instead.
  queryDiagramAvailable: boolean;
  queryDiagramHasWarnings: boolean;
  sqlHtml: string;
  // "Run EXPLAIN ANALYZE" (2026-08-20 follow-up) - whether this
  // connection's Provider can actually collect an analyze-mode plan at
  // all (driver.checkPerformanceTuningContextAvailability(), the same
  // static per-Provider capability check RunActualPlanActionCommand's
  // handler itself does not need to repeat). `message` (when present)
  // explains an unavailable capability in the button tooltip.
  analyzedExecutionPlan: CapabilityStatus;
};

// DynamoDB counterpart (2026-08-24 follow-up, design doc §11.3). No
// planTreeText/actualPlanDisplayText/planTableMappingRows/queryDiagram* -
// DynamoDB has no execution plan or declared-FK diagram to show (§6.1); its
// own structural evidence is accessPattern/humanSummary instead.
export type DynamoDbPerformanceTuningInitializeViewModel = PerformanceTuningPreviewShellFields & {
  engine: "dynamodb";
  context: DynamoDbPerformanceTuningContext;
  diagnosticGroups: PerformanceTuningDiagnosticGroupViewModel[];
  accessPattern: DynamoDbAccessPatternViewModel;
  humanSummary: DynamoDbPerformanceTuningHumanSummary;
  // Only set when context.statement.text is present (a PartiQL statement) -
  // a native Query/Scan statement has no SQL-like text to highlight; its
  // value-ful, Preview-only rendering is carried separately in nativeQuery.
  sqlHtml?: string;
  // Ephemeral Preview-only rendering of the value-ful native Query input.
  // It is deliberately not part of DynamoDbPerformanceTuningContext, so it
  // never enters Full Context JSON, saved DBNs, comparisons, or AI prompts.
  nativeQuery?: DynamoDbNativeQueryViewModel;
  // "Run Observed Read" - the DynamoDB counterpart of RDB's
  // analyzedExecutionPlan above, kept as its own field (not the same field
  // reused) since the two capabilities are genuinely different checks with
  // different messages - see DynamoDbPerformanceTuningCapabilities.observedRead's
  // own doc comment in db-drivers for why `available` here never implies the
  // caller's IAM policy was verified.
  observedReadCapability: CapabilityStatus;
};

export type DynamoDbNativeQueryViewModel = {
  target: string;
  keyCondition: { raw: string; resolved: string };
  filter?: { raw: string; resolved: string };
  projection?: { raw: string; resolved: string };
  select?: string;
  expressionAttributeNames: Array<{ token: string; name: string }>;
  expressionAttributeValues: Array<{ token: string; value: string }>;
  consistentRead: "Strong" | "Eventual";
  scanDirection: "Ascending" | "Descending";
  limit?: number;
};

export type PerformanceTuningPreviewPanelEventData = BaseMessageEventData<
  | BaseMessageEventDataCommand
  | "analysis-update"
  | "comparison-update"
  | "ai-send-preview"
  | "ai-send-preview-closed",
  "PerformanceTuningPreviewPanel",
  {
    initialize?:
      | RelationalPerformanceTuningInitializeViewModel
      | DynamoDbPerformanceTuningInitializeViewModel;
    analysis?: PerformanceTuningAiAnalysisViewState;
    // Set only when Copilot advertised a model that its request endpoint then
    // rejected as model_not_supported. The webview removes it immediately;
    // the host also remembers it for the lifetime of this Preview panel so a
    // later context re-render cannot add it back.
    unavailableLanguageModelId?: string;
    // Sent on its own by "comparison-update" whenever a baseline is selected,
    // changed, cleared, or the Current Context was re-collected underneath an
    // existing selection (§16 Phase 2).
    comparison?: PerformanceTuningComparisonViewState;
    aiSendPreview?: PreparedAiPayload;
    aiSendPreviewClosedRequestId?: string;
  }
>;

// PerformanceTuningBindParametersPanel.vue (2026-08-19 follow-up) - the
// shared "confirm bind values" panel both Query Statistics and Query History
// route through via openPerformanceTuningPreview() whenever the target SQL
// has detected placeholders. See src/panels/PerformanceTuningBindParametersPanel.ts.
export type PerformanceTuningBindParametersPanelEventData = BaseMessageEventData<
  BaseMessageEventDataCommand | "collection-result",
  "PerformanceTuningBindParametersPanel",
  {
    initialize?: {
      sqlHtml: string;
      // Only used for BindParametersEditor.vue's "Add parameter" marker
      // convention (nextManualMarker() in bindParameterRows.ts) - never a
      // ConnectionSetting or any other identifying detail.
      dbType: string;
      estimatedBindParameters: EstimatedBindParameter[];
      // Real values to pre-fill each row's input with, parallel to
      // estimatedBindParameters by `position` (index position - 1) - e.g.
      // Query History's last-executed variables. Undefined for Query
      // Statistics (no such source), which keeps every row starting blank
      // exactly as before.
      presetBindValues?: unknown[];
    };
    // Posted only on "cancelled"/"failed" - a successful collection instead
    // opens PerformanceTuningPreviewPanel and disposes this panel, so there
    // is nothing further for this panel's own webview to render.
    collectionResult?: {
      status: "cancelled" | "failed";
      message?: string;
      technicalMessage?: string;
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
    // Query Statistics always receives its complete state snapshot.
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
    setting: ConnectionSetting & {
      mcpEnabled?: boolean;
      aiMaskingLevel?: AiMaskingLevel;
    };
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
