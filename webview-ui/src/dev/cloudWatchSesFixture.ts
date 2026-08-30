import type {
  CloudWatchDashboardHostMessage,
  CloudWatchDashboardInitializePayload,
  DashboardTimeSeries,
} from "@/utilities/vscode";

const dashboardId = "aws-cloudwatch-metrics";
const resourceKey = "preview:aws.ses.account-region:ap-northeast-1";
const requestId = 1;
const timestamps = [
  "2026-08-29T08:00:00.000Z",
  "2026-08-29T08:30:00.000Z",
  "2026-08-29T09:00:00.000Z",
  "2026-08-29T09:30:00.000Z",
  "2026-08-29T10:00:00.000Z",
  "2026-08-29T10:30:00.000Z",
];

function series(id: string, label: string, values: number[], unit: string): DashboardTimeSeries {
  return {
    id,
    label,
    unit,
    status: "complete",
    points: timestamps.map((x, index) => ({ x, y: values[index] })),
  };
}

const initialize: CloudWatchDashboardInitializePayload = {
  providerId: "aws.ses.account-region",
  variant: "account-region",
  target: {
    resourceKey,
    displayName: "SES account",
    sourceLabel: "CloudWatch / AWS/SES / ap-northeast-1",
    environmentLabel: "Production",
    scope: {
      kind: "account-region",
      label: "SES account in ap-northeast-1",
    },
  },
  status: "loading",
  tabs: [{ id: "overview", title: "Overview" }],
  activeTabId: "overview",
  selectors: [
    {
      id: "dashboard-time-range",
      label: "Time range",
      value: "3d",
      options: [
        { value: "12h", label: "12 hours" },
        { value: "3d", label: "3 days" },
        { value: "15d", label: "15 days" },
      ],
    },
  ],
  panels: [
    {
      id: "sending-volume",
      title: "Sending and delivery",
      purpose: "workload",
      scope: { kind: "account-region", label: "SES account in ap-northeast-1" },
      visualization: "line",
      emission: "activity-dependent",
      cost: { publication: "included", read: "get-metric-data" },
      queries: [],
      caveat:
        "These values cover the AWS account in the selected Region, not an individual SES identity.",
    },
    {
      id: "delivery-problems",
      title: "Delivery problems",
      purpose: "health",
      scope: { kind: "account-region", label: "SES account in ap-northeast-1" },
      visualization: "line",
      emission: "activity-dependent",
      cost: { publication: "included", read: "get-metric-data" },
      queries: [],
    },
    {
      id: "reputation",
      title: "Account reputation rates",
      purpose: "health",
      scope: { kind: "account-region", label: "SES account in ap-northeast-1" },
      visualization: "line",
      emission: "activity-dependent",
      cost: { publication: "included", read: "get-metric-data" },
      queries: [],
      thresholds: [
        { value: 0.05, label: "Bounce rate 5%", severity: "warn" },
        { value: 0.001, label: "Complaint rate 0.1%", severity: "warn" },
      ],
      caveat:
        "These are the reputation rates published directly by SES. They are not calculated as events divided by sends for the selected time range.",
    },
    {
      id: "observed-events",
      title: "Additional observed events",
      purpose: "workload",
      scope: { kind: "account-region", label: "SES account in ap-northeast-1" },
      visualization: "line",
      emission: "opt-in",
      cost: { publication: "service-option", read: "get-metric-data" },
      queries: [],
      collapsedByDefault: true,
    },
  ],
  notices: [],
  range: "3d",
  queryCount: 10,
  autoRefresh: { allowed: true, intervalMinutes: 0 },
};

export const cloudWatchSesFixtureMessages: CloudWatchDashboardHostMessage[] = [
  {
    command: "loading",
    dashboardId,
    requestId,
    resourceKey,
    payload: { status: "loading" },
  },
  {
    command: "initialize",
    dashboardId,
    requestId,
    resourceKey,
    payload: initialize,
  },
  {
    command: "set-metrics",
    dashboardId,
    requestId,
    resourceKey,
    payload: {
      status: "ready",
      collectedAt: "2026-08-29T11:00:00.000Z",
      periodSeconds: 300,
      panelSeries: [
        {
          panelId: "sending-volume",
          series: [
            series("send", "Sent", [920, 1010, 1080, 990, 1130, 1170], "count"),
            series("delivery", "Delivered", [901, 993, 1057, 968, 1109, 1144], "count"),
          ],
        },
        {
          panelId: "delivery-problems",
          series: [
            series("bounce", "Bounces", [12, 10, 14, 11, 13, 16], "count"),
            series("complaint", "Complaints", [0, 1, 0, 0, 1, 0], "count"),
            series("delivery_delay", "Delivery delays", [7, 5, 9, 4, 6, 8], "count"),
          ],
        },
        {
          panelId: "reputation",
          series: [
            series("bounce-rate", "Bounce rate", [0.031, 0.034, 0.039, 0.044, 0.052, 0.047], "percent"),
            series(
              "complaint-rate",
              "Complaint rate",
              [0.0004, 0.0005, 0.0006, 0.0008, 0.0011, 0.0009],
              "percent"
            ),
          ],
        },
        {
          panelId: "observed-events",
          series: [
            series("open", "Open", [390, 420, 448, 401, 466, 480], "count"),
            series("click", "Click", [71, 83, 78, 74, 91, 96], "count"),
          ],
        },
      ],
    },
  },
];
