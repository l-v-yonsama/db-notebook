import type { MqttQoS } from "@l-v-yonsama/multi-platform-database-drivers";
import type { NotebookCellKind, NotebookCellOutput, Uri } from "vscode";
import type { RunResultMetadata } from "../shared/RunResultMetadata";

export type SQLMode = "None" | "Query" | "Explain" | "ExplainAnalyze";

export type CellMetaChart = {
  title: string;
  type: "bar" | "doughnut" | "line" | "pie" | "radar" | "scatter" | "pairPlot" | "histogram";
  multipleDataset: boolean;
  showDataLabels: boolean;
  showTitle: boolean;
  stacked?: boolean;
  label: string;
  data: string;
  dataX: string;
  dataY: string;
  data2?: string;
  data3?: string;
  data4?: string;
};

export type PublishParams = {
  topicName: string;
  qos: MqttQoS;
  retain: boolean;
};

export type SubscribeParams = {
  expandJsonColumn: boolean;
};

export type CellMeta = {
  markAsSkip?: boolean;
  markAsRunInOrderAtJsonCell?: boolean;
  connectionName?: string;
  showComment?: boolean;
  // Short, user-set label for a non-markup cell whose content isn't
  // self-describing (typically a JSON code cell) - shown in the notebook's
  // TOC/HTML report in place of the generic language+status tags. Distinct
  // from `showComment` above (an unrelated result-display toggle). Not
  // language-restricted at the type level, but only offered for JSON cells
  // today (CellLabelProvider in statusBarProviders.ts).
  cellLabel?: string;
  ruleFile?: string;
  codeResolverFile?: string;
  sharedVariableName?: string;
  useDatabaseName?: string;
  logGroupName?: string;
  logGroupStartTimeOffset?: "1m" | "5m" | "15m" | "30m" | "1h" | "6h" | "12h" | "1d" | "1w";
  chart?: CellMetaChart;
  publishParams?: PublishParams;
  subscribeParams?: SubscribeParams;
  readonly [key: string]: any;
};

export type NotebookMeta = {
  readonly [key: string]: any;
};

export type RawNotebookData = {
  cells: RawNotebookCell[];
  metadata?: NotebookMeta;
};

export type RawNotebookCell = {
  language: string;
  value: string;
  kind: NotebookCellKind;
  editable?: boolean;
  metadata?: CellMeta;
  outputs?: NotebookCellOutput[];
};

export type NotebookExecutionVariables = {
  _skipSql?: boolean;
  [key: string]: any;
};

export type RunResult = {
  stdout: string;
  stderr: string;
  skipped: boolean;
  evaluated?: boolean;
  status: "skipped" | "executed" | "error";
  metadata?: RunResultMetadata;
};

export type NotebookToolbarClickEvent = {
  notebookEditor: { notebookUri: Uri };
  ui: boolean;
};
