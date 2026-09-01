/* eslint-disable @typescript-eslint/naming-convention */
import type {
  DashboardClientMessage,
  DashboardMessageEnvelope,
  DashboardHostMessage,
} from "./DashboardMessages";
import type {
  DashboardDisplayStatus,
  DashboardPanelPresentation,
  DashboardTimeSeries,
} from "./DashboardPresentation";
import type { DashboardInitializePayload } from "./DashboardMessages";

export type CloudWatchMetricEmission = "default" | "activity-dependent" | "opt-in";

export type CloudWatchMetricCostProfile = {
  publication: "included" | "service-option" | "custom-metric";
  read: "get-metric-data";
  note?: string;
};

export type CloudWatchResolvedQueryPresentation = {
  id: string;
  namespace: string;
  metricName: string;
  statistic: string;
  label: string;
  unit: string;
  dimensions: Array<{ Name: string; Value: string }>;
};

export type CloudWatchPanelPresentation = DashboardPanelPresentation & {
  emission: CloudWatchMetricEmission;
  cost: CloudWatchMetricCostProfile;
  queries: CloudWatchResolvedQueryPresentation[];
  derivedSeries?: Array<{
    id: string;
    label: string;
    unit: string;
    operation: "sum" | "difference" | "ratio" | "percent";
    inputSeriesIds: string[];
  }>;
  thresholds?: Array<{
    value: number;
    label: string;
    severity: "warn" | "error";
  }>;
  emptyHint?: string;
  prerequisite?: {
    status: "configured" | "not-configured" | "unknown" | "not-applicable";
    title?: string;
    message?: string;
  };
};

export type CloudWatchMetricsPayload = {
  panelSeries: Array<{ panelId: string; series: DashboardTimeSeries[] }>;
  status: DashboardDisplayStatus;
  collectedAt: string;
  periodSeconds: number;
};

export type CloudWatchAutoRefreshMinutes = 0 | 1 | 5 | 15;

export type CloudWatchDashboardInitializePayload =
  DashboardInitializePayload<CloudWatchPanelPresentation> & {
    variant: string;
    range: string;
    queryCount: number;
    autoRefresh: {
      allowed: boolean;
      intervalMinutes: CloudWatchAutoRefreshMinutes;
    };
  };

export type CloudWatchDashboardClientMessage =
  | DashboardClientMessage
  | DashboardMessageEnvelope<
      "setAutoRefresh",
      { intervalMinutes: CloudWatchAutoRefreshMinutes }
    >;

export type CloudWatchDashboardHostMessage =
  | DashboardHostMessage<CloudWatchPanelPresentation, CloudWatchDashboardInitializePayload>
  | DashboardMessageEnvelope<"set-metrics", CloudWatchMetricsPayload>;
