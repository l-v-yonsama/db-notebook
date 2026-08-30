import type {
  DashboardClientMessage,
  DashboardHostMessage,
  DashboardMessageEnvelope,
} from "./DashboardMessages";
import type { DashboardPanelPresentation, DashboardTimeSeries } from "./DashboardPresentation";

export type RdbDrilldownAction = {
  id: string;
  label: string;
  command: string;
};

export type RdbDashboardPanelPresentation = DashboardPanelPresentation & {
  metricIds: string[];
  drilldownActions?: RdbDrilldownAction[];
};

export type RdbSamplingState = "stopped" | "starting" | "running" | "stopping" | "error";

export type RdbDashboardHostMessage =
  | DashboardHostMessage<RdbDashboardPanelPresentation>
  | DashboardMessageEnvelope<"append-sample", { series: DashboardTimeSeries[] }>
  | DashboardMessageEnvelope<"replace-series", { series: DashboardTimeSeries[] }>
  | DashboardMessageEnvelope<"set-sampling-state", { state: RdbSamplingState }>;

export type RdbDashboardClientMessage =
  | DashboardClientMessage
  | DashboardMessageEnvelope<"startSampling", { intervalSeconds: number }>
  | DashboardMessageEnvelope<"stopSampling", Record<string, never>>
  | DashboardMessageEnvelope<"changeSampleInterval", { intervalSeconds: number }>
  | DashboardMessageEnvelope<"openDrilldown", { actionId: string }>;
