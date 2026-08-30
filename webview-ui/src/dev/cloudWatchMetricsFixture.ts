import type { CloudWatchDashboardHostMessage, DashboardTimeSeries } from "@/utilities/vscode";

const dashboardId = "aws-cloudwatch-metrics";
const resourceKey = "preview:aws.sqs.queue:orders";
const requestId = 1;
const timestamps = [
  "2026-08-29T03:00:00.000Z",
  "2026-08-29T03:10:00.000Z",
  "2026-08-29T03:20:00.000Z",
  "2026-08-29T03:30:00.000Z",
  "2026-08-29T03:40:00.000Z",
  "2026-08-29T03:50:00.000Z",
];

function series(
  id: string,
  label: string,
  values: Array<number | null>,
  unit = "count"
): DashboardTimeSeries {
  return {
    id,
    label,
    unit,
    status: values.includes(null) ? "partial" : "complete",
    points: timestamps.map((x, index) => ({ x, y: values[index] ?? null })),
  };
}

export const cloudWatchMetricsFixtureMessages: CloudWatchDashboardHostMessage[] = [
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
    payload: {
      providerId: "aws.sqs.queue",
      variant: "standard",
      target: {
        resourceKey,
        displayName: "orders",
        sourceLabel: "CloudWatch / AWS/SQS / ap-northeast-1",
        environmentLabel: "Development",
        scope: { kind: "resource", label: "Queue orders" },
      },
      status: "loading",
      tabs: [{ id: "overview", title: "Overview" }],
      activeTabId: "overview",
      selectors: [
        {
          id: "dashboard-time-range",
          label: "Time range",
          value: "1h",
          options: [
            { value: "15m", label: "15 minutes" },
            { value: "1h", label: "1 hour" },
            { value: "3h", label: "3 hours" },
          ],
        },
      ],
      panels: [
        {
          id: "backlog",
          title: "Backlog",
          purpose: "health",
          scope: { kind: "resource", label: "orders" },
          visualization: "stacked-area",
          emission: "activity-dependent",
          cost: { publication: "included", read: "get-metric-data" },
          queries: [],
          caveat: "No datapoints does not prove that an inactive queue is empty.",
        },
        {
          id: "oldest-message",
          title: "Oldest message age",
          purpose: "health",
          scope: { kind: "resource", label: "orders" },
          visualization: "line",
          emission: "activity-dependent",
          cost: { publication: "included", read: "get-metric-data" },
          queries: [],
        },
        {
          id: "message-flow",
          title: "Message flow",
          purpose: "workload",
          scope: { kind: "resource", label: "orders" },
          visualization: "line",
          emission: "activity-dependent",
          cost: { publication: "included", read: "get-metric-data" },
          queries: [],
        },
      ],
      notices: [],
      range: "1h",
      queryCount: 8,
      autoRefresh: { allowed: true, intervalMinutes: 0 },
    },
  },
  {
    command: "set-metrics",
    dashboardId,
    requestId,
    resourceKey,
    payload: {
      status: "partial",
      collectedAt: "2026-08-29T04:00:00.000Z",
      periodSeconds: 60,
      panelSeries: [
        {
          panelId: "backlog",
          series: [
            series("visible", "Visible", [5, 8, 13, 9, 4, 2]),
            series("inflight", "In flight", [1, 2, 3, 2, 1, 0]),
            series("delayed", "Delayed", [0, 0, 2, null, 1, 0]),
          ],
        },
        {
          panelId: "oldest-message",
          series: [series("oldest", "Oldest message age", [8, 15, 31, 18, 9, 4], "seconds")],
        },
        {
          panelId: "message-flow",
          series: [
            series("sent", "Sent", [20, 35, 42, 31, 28, 25]),
            series("received", "Received", [18, 30, 40, 34, 30, 26]),
            series("deleted", "Deleted", [17, 28, 39, 33, 28, 26]),
          ],
        },
      ],
    },
  },
];
