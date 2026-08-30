export type DashboardDisplayStatus =
  | "loading"
  | "ready"
  | "partial"
  | "empty"
  | "unconfigured"
  | "unavailable"
  | "error"
  | "cancelled";

export type DashboardTargetPresentation = {
  resourceKey: string;
  displayName: string;
  sourceLabel: string;
  environmentLabel?: string;
  scope: { kind: string; label: string };
};

export type DashboardNotice = {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  code?: string;
  documentationUrl?: string;
};

export type DashboardSelector = {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string; description?: string }>;
};

export type DashboardTabPresentation = {
  id: string;
  title: string;
};

export type DashboardTimeSeriesPoint = {
  x: string;
  /** null means missing data. An observed zero remains 0. */
  y: number | null;
};

export type DashboardTimeSeries = {
  id: string;
  label: string;
  unit: string;
  points: DashboardTimeSeriesPoint[];
  status: "complete" | "partial" | "no-data" | "unavailable" | "forbidden" | "failed";
  diagnostics?: Array<{ code?: string; message?: string }>;
};

export type DashboardPanelPresentation = {
  id: string;
  title: string;
  purpose: "workload" | "health" | "capacity" | "lifecycle" | "configuration";
  scope: { kind: string; label: string };
  visualization: "line" | "bar" | "stacked-area" | "stat-grid" | "table" | "state-card";
  caveat?: string;
  collapsedByDefault?: boolean;
};
