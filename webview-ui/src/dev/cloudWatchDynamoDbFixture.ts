import type { CloudWatchDashboardHostMessage, DashboardTimeSeries } from "@/utilities/vscode";

const dashboardId = "aws-cloudwatch-metrics";
const resourceKey = "preview:aws.dynamodb.table:orders";
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
  unit: string
): DashboardTimeSeries {
  return {
    id,
    label,
    unit,
    status: values.includes(null) ? "partial" : "complete",
    points: timestamps.map((x, index) => ({ x, y: values[index] ?? null })),
  };
}

export const cloudWatchDynamoDbFixtureMessages: CloudWatchDashboardHostMessage[] = [
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
      providerId: "aws.dynamodb.table",
      variant: "provisioned",
      target: {
        resourceKey,
        displayName: "orders",
        sourceLabel: "CloudWatch / AWS/DynamoDB / ap-northeast-1",
        environmentLabel: "Development",
        scope: { kind: "resource", label: "Table orders" },
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
        {
          id: "dynamodb-operation",
          label: "Operation",
          value: "Query",
          options: [
            { value: "Query", label: "Query" },
            { value: "Scan", label: "Scan" },
            { value: "ExecuteStatement", label: "PartiQL SELECT" },
          ],
        },
      ],
      panels: [
        {
          id: "consumed-capacity",
          title: "Consumed capacity",
          purpose: "workload",
          scope: { kind: "resource", label: "Table orders and its GSIs" },
          visualization: "line",
          emission: "default",
          cost: { publication: "included", read: "get-metric-data" },
          queries: [],
          caveat: "These are table and index totals for each CloudWatch period, not one operation.",
        },
        {
          id: "request-latency",
          title: "Query successful request latency",
          purpose: "health",
          scope: { kind: "sub-resource", label: "orders / Query" },
          visualization: "line",
          emission: "activity-dependent",
          cost: { publication: "included", read: "get-metric-data" },
          queries: [],
        },
        {
          id: "returned-items",
          title: "Query returned items",
          purpose: "workload",
          scope: { kind: "sub-resource", label: "orders / Query" },
          visualization: "bar",
          emission: "activity-dependent",
          cost: { publication: "included", read: "get-metric-data" },
          queries: [],
        },
        {
          id: "ttl-deletions",
          title: "TTL deleted items",
          purpose: "lifecycle",
          scope: { kind: "resource", label: "Table orders" },
          visualization: "bar",
          emission: "activity-dependent",
          cost: { publication: "included", read: "get-metric-data" },
          queries: [],
          collapsedByDefault: true,
        },
      ],
      notices: [],
      range: "1h",
      queryCount: 18,
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
          panelId: "consumed-capacity",
          series: [
            series("table-read", "Table read", [24, 30, 36, 28, 42, 35], "capacity-unit"),
            series("table-write", "Table write", [8, 12, 9, 15, 13, 11], "capacity-unit"),
            series("gsi-read", "GSI by-status read", [11, 14, 17, 12, 19, 16], "capacity-unit"),
          ],
        },
        {
          panelId: "request-latency",
          series: [
            series("p50", "p50", [3.2, 3.8, 3.1, 4.2, 3.5, 3.3], "milliseconds"),
            series("p90", "p90", [6.4, 7.3, 6.1, 8.2, 7.1, 6.8], "milliseconds"),
            series("p99", "p99", [12, 15, 11, 18, 14, 13], "milliseconds"),
          ],
        },
        {
          panelId: "returned-items",
          series: [series("returned", "Returned items", [41, 55, 38, 72, 63, 49], "count")],
        },
        {
          panelId: "ttl-deletions",
          series: [series("ttl", "TTL deleted items", [0, 2, 1, 0, 4, 1], "count")],
        },
      ],
    },
  },
];
