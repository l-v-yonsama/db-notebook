import type {
  CloudWatchDashboardHostMessage,
  CloudWatchDashboardInitializePayload,
  DashboardTimeSeries,
} from "@/utilities/vscode";

const dashboardId = "aws-cloudwatch-metrics";
const resourceKey = "preview:aws.s3.bucket:orders-archive";
const requestId = 1;
const timestamps = [
  "2026-08-29T08:00:00.000Z",
  "2026-08-29T08:10:00.000Z",
  "2026-08-29T08:20:00.000Z",
  "2026-08-29T08:30:00.000Z",
  "2026-08-29T08:40:00.000Z",
  "2026-08-29T08:50:00.000Z",
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

function initializePayload(configured: boolean): CloudWatchDashboardInitializePayload {
  const prerequisite = configured
    ? { status: "configured" as const }
    : {
        status: "not-configured" as const,
        title: "S3 request metrics are not enabled",
        message:
          "Create an S3 metrics configuration for the bucket, prefix, tag, or access point. Additional charges can apply.",
      };
  const commonPanel = {
    purpose: "workload" as const,
    scope: {
      kind: "configured-filter",
      label: configured ? "orders-archive / incoming-prefix" : "Bucket orders-archive",
    },
    visualization: "line" as const,
    emission: "opt-in" as const,
    cost: {
      publication: "service-option" as const,
      read: "get-metric-data" as const,
    },
    queries: [],
    prerequisite,
  };
  return {
    providerId: "aws.s3.bucket",
    variant: "bucket",
    target: {
      resourceKey,
      displayName: "orders-archive",
      sourceLabel: "CloudWatch / AWS/S3 / us-west-2",
      environmentLabel: "Development",
      scope: { kind: "configured-filter", label: "Bucket orders-archive" },
    },
    status: "loading",
    tabs: [
      { id: "storage", title: "Storage (daily)" },
      { id: "requests", title: "Requests" },
    ],
    activeTabId: "requests",
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
      ...(configured
        ? [
            {
              id: "s3-request-filter",
              label: "Metrics configuration",
              value: "incoming-prefix",
              options: [
                { value: "all-requests", label: "all-requests" },
                { value: "incoming-prefix", label: "incoming-prefix" },
              ],
            },
          ]
        : []),
    ],
    panels: [
      {
        ...commonPanel,
        id: "request-counts",
        title: "Requests by operation",
        caveat:
          "Values apply only to the selected metrics configuration. Overlapping filters are not combined.",
      },
      {
        ...commonPanel,
        id: "request-errors",
        title: "Request errors",
        purpose: "health",
      },
      {
        ...commonPanel,
        id: "request-latency",
        title: "Request latency",
        purpose: "health",
      },
    ],
    notices: configured
      ? []
      : [
          {
            id: "prerequisite-s3-request-metrics",
            severity: "warning",
            title: "S3 request metrics are not enabled",
            message: "Create an S3 metrics configuration. Additional charges can apply.",
          },
        ],
    range: "1h",
    queryCount: configured ? 10 : 0,
    autoRefresh: { allowed: true, intervalMinutes: 0 },
  };
}

function fixtureMessages(configured: boolean): CloudWatchDashboardHostMessage[] {
  return [
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
      payload: initializePayload(configured),
    },
    {
      command: "set-metrics",
      dashboardId,
      requestId,
      resourceKey,
      payload: {
        status: configured ? "ready" : "empty",
        collectedAt: "2026-08-29T09:00:00.000Z",
        periodSeconds: 60,
        panelSeries: configured
          ? [
              {
                panelId: "request-counts",
                series: [
                  series("get", "GET", [18, 31, 27, 45, 38, 42], "count"),
                  series("put", "PUT", [4, 8, 6, 12, 9, 7], "count"),
                ],
              },
              {
                panelId: "request-errors",
                series: [
                  series("4xx", "4xx errors", [0, 1, 0, 2, 0, 0], "count"),
                  series("5xx", "5xx errors", [0, 0, 0, 0, 1, 0], "count"),
                ],
              },
              {
                panelId: "request-latency",
                series: [
                  series("first-byte", "First byte p90", [22, 31, 28, 35, 26, 24], "milliseconds"),
                  series("total", "Total p90", [48, 62, 55, 71, 53, 50], "milliseconds"),
                ],
              },
            ]
          : [],
      },
    },
  ];
}

export const cloudWatchS3FixtureMessages = fixtureMessages(true);
export const cloudWatchS3UnconfiguredFixtureMessages = fixtureMessages(false);
