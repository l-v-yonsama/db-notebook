import type { CloudWatchDashboardHostMessage, DashboardTimeSeries } from "@/utilities/vscode";

const dashboardId = "aws-cloudwatch-metrics-overview";
const resourceKey = "preview:aws.sqs.overview";
const requestId = 1;
const timestamps = [
  "2026-08-29T03:00:00.000Z",
  "2026-08-29T03:15:00.000Z",
  "2026-08-29T03:30:00.000Z",
  "2026-08-29T03:45:00.000Z",
];

function queueSeries(index: number): DashboardTimeSeries {
  const base = 42 - index * 2;
  return {
    id: `queue_visible_${index}`,
    label: `orders-${String(index + 1).padStart(2, "0")}`,
    unit: "count",
    status: "complete",
    points: timestamps.map((x, point) => ({ x, y: Math.max(0, base - point * 3) })),
  };
}

export const cloudWatchSqsOverviewFixtureMessages: CloudWatchDashboardHostMessage[] = [
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
      providerId: "aws.sqs.overview",
      variant: "service-overview",
      target: {
        resourceKey,
        displayName: "SQS service overview",
        sourceLabel: "CloudWatch / AWS/SQS / ap-northeast-1",
        environmentLabel: "Production",
        scope: { kind: "dimension-group", label: "SQS resources in ap-northeast-1" },
      },
      status: "loading",
      tabs: [{ id: "overview", title: "Queue comparison" }],
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
        {
          id: "overview-series-limit",
          label: "Displayed resources",
          value: "20",
          options: [
            { value: "10", label: "Top 10 (32 series queried)" },
            { value: "20", label: "Top 20 (32 series queried)" },
            { value: "all", label: "All 32" },
          ],
        },
      ],
      panels: [
        {
          id: "queue-backlog-comparison",
          title: "Queue backlog comparison",
          purpose: "health",
          scope: { kind: "dimension-group", label: "SQS queues" },
          visualization: "bar",
          emission: "activity-dependent",
          cost: {
            publication: "included",
            read: "get-metric-data",
            note: "One CloudWatch metric series is read per evaluated queue.",
          },
          queries: [],
          caveat:
            "Ranking is calculated after 32 CloudWatch series are queried; the toolbar shows the actual per-refresh read count.",
        },
      ],
      notices: [],
      range: "1h",
      queryCount: 32,
      autoRefresh: { allowed: true, intervalMinutes: 0 },
    },
  },
  {
    command: "set-metrics",
    dashboardId,
    requestId,
    resourceKey,
    payload: {
      status: "ready",
      collectedAt: "2026-08-29T04:00:00.000Z",
      periodSeconds: 60,
      panelSeries: [
        {
          panelId: "queue-backlog-comparison",
          series: Array.from({ length: 20 }, (_, index) => queueSeries(index)),
        },
      ],
    },
  },
];
