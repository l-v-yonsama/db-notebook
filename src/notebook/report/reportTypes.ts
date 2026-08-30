import type { ResultSetData } from "@l-v-yonsama/rdh";
import type { NotebookCellKind } from "vscode";

export type ReportKind = "aws-cloudwatch-metrics" | "rdb-database";

export type ReportChartSpec = {
  version: 1;
  renderer: "chartjs";
  type: "line" | "bar" | "stacked-area";
  title: string;
  dataShape: "long";
  xKey: string;
  seriesKey: string;
  valueKey: string;
  series: Array<{ id: string; label: string; unit?: string }>;
  xAxis?: {
    type: "category" | "time";
    display: "auto" | "time" | "date" | "date-time";
  };
  markers?: {
    kind: "reset";
    timestampKey: string;
    labelKey: string;
  };
};

export type ReportCellMetadata = {
  cellLabel?: string;
  inputCollapsed?: boolean;
  reportChart?: ReportChartSpec;
  readonly [key: string]: unknown;
};

export type PersistedReportOutputMetadata = {
  schemaVersion: 1;
  kind: "result-set";
  rdh: ResultSetData;
};

export type PersistedCellOutputItem = {
  mime: string;
  encoding: "utf8" | "base64";
  data: string;
};

export type PersistedCellOutput = {
  items: PersistedCellOutputItem[];
  metadata?: PersistedReportOutputMetadata;
};

export type RawReportNotebookCell = {
  kind: NotebookCellKind;
  language: string;
  value: string;
  metadata?: ReportCellMetadata;
  outputs?: PersistedCellOutput[];
};

export type RawReportNotebookData = {
  formatVersion: 1;
  reportKind: ReportKind;
  metadata?: Record<string, unknown>;
  cells: RawReportNotebookCell[];
};

export function isPersistedReportOutputMetadata(
  value: unknown
): value is PersistedReportOutputMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const metadata = value as Partial<PersistedReportOutputMetadata>;
  return metadata.schemaVersion === 1 && metadata.kind === "result-set" && !!metadata.rdh;
}

export function isReportChartSpec(value: unknown): value is ReportChartSpec {
  if (!value || typeof value !== "object") {
    return false;
  }
  const spec = value as Partial<ReportChartSpec>;
  const validXAxis =
    spec.xAxis === undefined ||
    (typeof spec.xAxis === "object" &&
      ["category", "time"].includes(spec.xAxis.type) &&
      ["auto", "time", "date", "date-time"].includes(spec.xAxis.display));
  return (
    spec.version === 1 &&
    spec.renderer === "chartjs" &&
    ["line", "bar", "stacked-area"].includes(spec.type ?? "") &&
    spec.dataShape === "long" &&
    typeof spec.title === "string" &&
    typeof spec.xKey === "string" &&
    typeof spec.seriesKey === "string" &&
    typeof spec.valueKey === "string" &&
    Array.isArray(spec.series) &&
    validXAxis
  );
}
