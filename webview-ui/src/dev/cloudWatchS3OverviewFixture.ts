import type { CloudWatchDashboardHostMessage, DashboardTimeSeries } from "@/utilities/vscode";

const dashboardId = "aws-cloudwatch-metrics-overview";
const resourceKey = "preview:aws.s3.overview";
const requestId = 1;
const timestamps = [
  "2026-08-25T00:00:00.000Z",
  "2026-08-26T00:00:00.000Z",
  "2026-08-27T00:00:00.000Z",
  "2026-08-28T00:00:00.000Z",
  "2026-08-29T00:00:00.000Z",
];

function bucketSeries(index: number): DashboardTimeSeries {
  const gibibytes = 180 - index * 7;
  return {
    id: `bucket_${index}_total`,
    label: `archive-${String(index + 1).padStart(2, "0")}`,
    unit: "bytes",
    status: index === 7 ? "partial" : "complete",
    points: timestamps.map((x, day) => ({
      x,
      y: index === 7 && day === 2 ? null : (gibibytes + day * (index + 1) * 0.35) * 1024 ** 3,
    })),
    diagnostics:
      index === 7
        ? [{ code: "PartialData", message: "One storage type was incomplete for this day." }]
        : [],
  };
}

export const cloudWatchS3OverviewFixtureMessages: CloudWatchDashboardHostMessage[] = [
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
      providerId: "aws.s3.overview",
      variant: "service-overview",
      target: {
        resourceKey,
        displayName: "S3 service overview",
        sourceLabel: "CloudWatch / AWS/S3 / ap-northeast-1",
        environmentLabel: "Production",
        scope: {
          kind: "dimension-group",
          label: "S3 buckets across resolved bucket regions",
        },
      },
      status: "loading",
      tabs: [{ id: "overview", title: "Bucket comparison" }],
      activeTabId: "overview",
      selectors: [
        {
          id: "dashboard-time-range",
          label: "Time range",
          value: "30d",
          options: [
            { value: "3d", label: "3 days" },
            { value: "15d", label: "15 days" },
            { value: "30d", label: "30 days" },
          ],
        },
        {
          id: "overview-series-limit",
          label: "Displayed resources",
          value: "20",
          options: [
            { value: "10", label: "Top 10 (48 API series / 23 resources)" },
            { value: "20", label: "Top 20 (48 API series / 23 resources)" },
            { value: "all", label: "All 23" },
          ],
        },
      ],
      panels: [
        {
          id: "bucket-size-comparison",
          title: "Daily bucket size comparison",
          purpose: "capacity",
          scope: { kind: "dimension-group", label: "S3 buckets" },
          visualization: "bar",
          emission: "default",
          cost: {
            publication: "included",
            read: "get-metric-data",
            note: "48 storage-class CloudWatch series are read for 23 evaluated buckets.",
          },
          queries: [],
          caveat:
            "Each bucket total sums every BucketSizeBytes StorageType currently published for that bucket, including metadata overhead and staging storage; missing inputs remain gaps.",
        },
      ],
      notices: [],
      range: "30d",
      queryCount: 48,
      autoRefresh: { allowed: false, intervalMinutes: 0 },
    },
  },
  {
    command: "set-metrics",
    dashboardId,
    requestId,
    resourceKey,
    payload: {
      status: "partial",
      collectedAt: "2026-08-30T00:15:00.000Z",
      periodSeconds: 86_400,
      panelSeries: [
        {
          panelId: "bucket-size-comparison",
          series: Array.from({ length: 20 }, (_, index) => bucketSeries(index)),
        },
      ],
    },
  },
];
