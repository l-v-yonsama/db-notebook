import type {
  DashboardClientMessage,
  DashboardHostMessage,
  DashboardMessageEnvelope,
} from "./DashboardMessages";
import type {
  DashboardDisplayStatus,
  DashboardPanelPresentation,
  DashboardTimeSeries,
} from "./DashboardPresentation";
import type { DashboardInitializePayload } from "./DashboardMessages";

export type RdbDrilldownAction = {
  id: string;
  label: string;
  command: string;
};

export type RdbDashboardPanelPresentation = DashboardPanelPresentation & {
  metricIds: string[];
  drilldownActions?: RdbDrilldownAction[];
  sectionStatus: "available" | "partial" | "unavailable";
  sectionMessage?: string;
};

export type RdbSamplingState = "stopped" | "starting" | "running" | "stopping" | "error";

export type RdbDashboardInitializePayload =
  DashboardInitializePayload<RdbDashboardPanelPresentation> & {
    variant: string;
    serverVersion: string;
    definitionVersion: number;
    samplePolicy: {
      defaultIntervalMs: number;
      allowedIntervalMs: readonly number[];
    };
  };

export type RdbDashboardSeriesPayload = {
  panelSeries: Array<{ panelId: string; series: DashboardTimeSeries[] }>;
  status: DashboardDisplayStatus;
  collectedAt: string;
  resetMarkers: Array<{
    metricId: string;
    observedAt: string;
    reasonLabel: string;
  }>;
  diagnostics: Array<{
    sectionId: string;
    severity: "info" | "warning" | "error";
    code: string;
    message: string;
  }>;
};

export type RdbSamplingStatePayload = {
  state: RdbSamplingState;
  intervalMs: number;
  sessionStartedAt?: string;
  lastSampleAt?: string;
  lastSampleDurationMs?: number;
  nextSampleAt?: string;
  message?: string;
};

export type RdbDashboardHostMessage =
  | DashboardHostMessage<RdbDashboardPanelPresentation, RdbDashboardInitializePayload>
  | DashboardMessageEnvelope<"replace-series", RdbDashboardSeriesPayload>
  | DashboardMessageEnvelope<"set-sampling-state", RdbSamplingStatePayload>;

export type RdbDashboardClientMessage =
  | DashboardClientMessage
  | DashboardMessageEnvelope<"startSampling", { intervalMs: number }>
  | DashboardMessageEnvelope<"stopSampling", Record<string, never>>
  | DashboardMessageEnvelope<"changeSampleInterval", { intervalMs: number }>
  | DashboardMessageEnvelope<"openDrilldown", { actionId: string; definitionVersion: number }>;
