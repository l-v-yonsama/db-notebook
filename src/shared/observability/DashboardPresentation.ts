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
  /** Complete target name shown on hover when displayName is shortened for layout. */
  fullDisplayName?: string;
  sourceLabel: string;
  environmentLabel?: string;
  scope: { kind: string; label: string; fullLabel?: string };
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

export const DASHBOARD_CHART_VISUALIZATIONS = ["line", "bar", "stacked-area"] as const;

export type DashboardChartVisualization = (typeof DASHBOARD_CHART_VISUALIZATIONS)[number];
export type DashboardVisualization =
  | DashboardChartVisualization
  | "stat-grid"
  | "table"
  | "state-card";

export function isDashboardChartVisualization(
  visualization: DashboardVisualization
): visualization is DashboardChartVisualization {
  return (DASHBOARD_CHART_VISUALIZATIONS as readonly string[]).includes(visualization);
}

export type DashboardTimeSeriesPoint = {
  x: string;
  /** null means missing data. An observed zero remains 0. */
  y: number | null;
};

export type DashboardTimeSeries = {
  id: string;
  label: string;
  unit: string;
  /** Whether collecting this metric contributes to the value being shown. */
  selfObservation?: "excluded" | "included" | "unknown";
  points: DashboardTimeSeriesPoint[];
  status: "complete" | "partial" | "no-data" | "unavailable" | "forbidden" | "failed";
  diagnostics?: Array<{ code?: string; message?: string }>;
};

export type DashboardPanelPresentation = {
  id: string;
  title: string;
  purpose: "workload" | "health" | "capacity" | "lifecycle" | "configuration";
  scope: { kind: string; label: string; fullLabel?: string };
  visualization: DashboardVisualization;
  caveat?: string;
  collapsedByDefault?: boolean;
};
