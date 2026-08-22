export type PerformanceTuningHumanSignal = {
  kind: "estimateAccuracy" | "tableHealth" | "collection";
  level: "info" | "attention" | "unknown";
  title: string;
  summary: string;
  tableRef?: string;
  rawDataPath: string;
};

export type PerformanceTuningRowFlow = {
    tableRef: string;
    totalRows?: number;
    totalRowsEstimated?: boolean;
  accessedRows?: number;
  filterInputRows?: number;
  filterOutputRows?: number;
  planOutputRows?: number;
  accessFraction?: number;
  filterPassRate?: number;
  valuesAreActual: boolean;
  rawDataPath: string;
};

export type PerformanceTuningHumanSummary = {
  profile: {
    statementKind: string;
    evidence: "actual" | "estimate";
    tableCount: number;
    tableRefs: string[];
    collectionStatus: "complete" | "partial";
  };
  signals: PerformanceTuningHumanSignal[];
  rowFlows: PerformanceTuningRowFlow[];
};
