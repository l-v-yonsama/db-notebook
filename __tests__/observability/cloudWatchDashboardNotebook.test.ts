import { NotebookCellKind } from "vscode";
import { describe, expect, it } from "vitest";
import {
  buildCloudWatchDashboardNotebookCells,
  buildCloudWatchDashboardNotebookData,
  buildCloudWatchReportFilename,
} from "../../src/observability/cloudWatchDashboardNotebook";
import type {
  CloudWatchDashboardInitializePayload,
  CloudWatchMetricsPayload,
} from "../../src/shared/observability";

const initialize: CloudWatchDashboardInitializePayload = {
  providerId: "aws.sqs.queue",
  variant: "standard",
  target: {
    resourceKey: "runtime-key",
    displayName: "orders",
    sourceLabel: "CloudWatch / AWS/SQS / ap-northeast-1",
    environmentLabel: "Production",
    scope: { kind: "resource", label: "Queue orders" },
  },
  status: "loading",
  tabs: [{ id: "overview", title: "Overview" }],
  activeTabId: "overview",
  selectors: [],
  panels: [
    {
      id: "backlog",
      title: "Backlog",
      purpose: "health",
      scope: { kind: "resource", label: "Queue orders" },
      visualization: "line",
      emission: "default",
      cost: { publication: "included", read: "get-metric-data" },
      queries: [
        {
          id: "visible",
          namespace: "AWS/SQS",
          metricName: "ApproximateNumberOfMessagesVisible",
          statistic: "Maximum",
          label: "Visible",
          unit: "count",
          dimensions: [{ Name: "QueueName", Value: "orders" }],
        },
        {
          id: "inflight",
          namespace: "AWS/SQS",
          metricName: "ApproximateNumberOfMessagesNotVisible",
          statistic: "Maximum",
          label: "In flight",
          unit: "count",
          dimensions: [{ Name: "QueueName", Value: "orders" }],
        },
      ],
    },
  ],
  notices: [
    {
      id: "partial-data",
      severity: "warning",
      title: "Partial data",
      message: "One series could not be read.",
    },
  ],
  range: "1h",
  queryCount: 2,
  autoRefresh: { allowed: true, intervalMinutes: 5 },
};

const metrics: CloudWatchMetricsPayload = {
  status: "partial",
  collectedAt: "2026-08-29T01:00:00.000Z",
  periodSeconds: 60,
  panelSeries: [
    {
      panelId: "backlog",
      series: [
        {
          id: "visible",
          label: "Visible",
          unit: "count",
          status: "complete",
          points: [
            { x: "2026-08-29T00:59:00.000Z", y: 0 },
            { x: "2026-08-29T01:00:00.000Z", y: null },
          ],
        },
        {
          id: "inflight",
          label: "In flight",
          unit: "count",
          status: "forbidden",
          points: [],
          diagnostics: [{ code: "AccessDenied", message: "GetMetricData denied" }],
        },
      ],
    },
  ],
};

describe("CloudWatch dashboard notebook export", () => {
  it("preserves zero, null, dimensions, status, and diagnostics", () => {
    const data = buildCloudWatchDashboardNotebookData(initialize, metrics);

    expect(data.summary[0]).toMatchObject({
      target: "orders",
      collectedAt: metrics.collectedAt,
      status: "partial",
      seriesPerRefresh: 2,
    });
    expect(data.metricSeries.map((row) => row.value)).toEqual([0, null]);
    expect(data.metricSeries[0]).toMatchObject({
      metricName: "ApproximateNumberOfMessagesVisible",
      statistic: "Maximum",
      status: "complete",
      dimensions: JSON.stringify([{ Name: "QueueName", Value: "orders" }]),
    });
    expect(data.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "AccessDenied", severity: "error" }),
        expect.objectContaining({ code: "partial-data", severity: "warning" }),
      ])
    );
  });

  it("creates a credential-free report whose full data is stored only in outputs", () => {
    const cells = buildCloudWatchDashboardNotebookCells(initialize, metrics);

    expect(cells).toHaveLength(3);
    expect(cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(cells[0].value).toContain("## Metrics without datapoints");
    expect(cells[0].value).toContain("**Backlog**");
    expect(cells[0].value).toContain("In flight (inflight, forbidden)");
    expect(cells[0].value).toContain("GetMetricData denied");
    expect(cells[1].kind).toBe(NotebookCellKind.Code);
    expect(cells[1].metadata).toMatchObject({
      cellLabel: "Dashboard summary",
      inputCollapsed: true,
    });
    expect(cells[2].metadata).toMatchObject({ cellLabel: "Backlog", inputCollapsed: true });
    const summaryPreview = String(cells[1].outputs?.[0]?.items[0]?.data);
    expect(summaryPreview).toContain("### Dashboard summary");
    expect(summaryPreview).toContain("`orders` · `AWS/SQS` · `ap-northeast-1`");
    const panelPreview = String(cells[2].outputs?.[0]?.items[0]?.data);
    expect(panelPreview).toContain("### Backlog");
    expect(panelPreview).toContain("`orders` · `default` · `1 of 2 series with datapoints`");
    expect(panelPreview).toContain(
      "> Saved dashboard snapshot. No AWS request is executed from this cell."
    );
    expect(cells.slice(1).every((cell) => cell.value.length < 100)).toBe(true);
    const code = cells
      .slice(1)
      .map((cell) => cell.value)
      .join("\n");
    expect(code).not.toContain("writeResultSetData");
    expect(code).not.toContain(metrics.collectedAt);
    expect(code).not.toContain("runtime-key");
    expect(
      cells.slice(1).every((cell) => {
        const metadata = cell.outputs?.[0]?.metadata as
          | { schemaVersion?: number; kind?: string; rdh?: { rows?: unknown[] } }
          | undefined;
        return metadata?.schemaVersion === 1 && metadata.kind === "result-set" && !!metadata.rdh;
      })
    ).toBe(true);
    const reportChart = (
      cells[2].metadata as {
        reportChart?: { series?: unknown[]; xAxis?: { type?: string; display?: string } };
      }
    ).reportChart;
    expect(reportChart?.series).toHaveLength(1);
    expect(reportChart?.xAxis).toEqual({ type: "time", display: "auto" });
  });

  it("limits the persisted markdown preview to ten data rows with a middle omission", () => {
    const manyPoints = Array.from({ length: 12 }, (_, index) => ({
      x: `2026-08-29T00:${String(index).padStart(2, "0")}:00.000Z`,
      y: index,
    }));
    const cells = buildCloudWatchDashboardNotebookCells(initialize, {
      ...metrics,
      panelSeries: [
        {
          panelId: "backlog",
          series: [
            {
              id: "visible",
              label: "Visible",
              unit: "count",
              status: "complete",
              points: manyPoints,
            },
          ],
        },
      ],
    });
    const preview = String(cells[2].outputs?.[0]?.items[0]?.data);

    expect(preview).toContain("2026-08-29T00:00:00.000Z");
    expect(preview).toContain("2026-08-29T00:11:00.000Z");
    expect(preview).not.toContain("2026-08-29T00:05:00.000Z");
    expect(preview).toContain("...");
  });

  it("omits empty panel cells and explains their metrics in the heading", () => {
    const emptyMetrics: CloudWatchMetricsPayload = {
      ...metrics,
      status: "empty",
      panelSeries: [
        {
          panelId: "backlog",
          series: initialize.panels[0].queries.map((query) => ({
            id: query.id,
            label: query.label,
            unit: query.unit,
            status: "no-data" as const,
            points: [],
          })),
        },
      ],
    };

    const cells = buildCloudWatchDashboardNotebookCells(initialize, emptyMetrics);
    expect(cells).toHaveLength(2);
    expect(cells.every((cell) => !(cell.metadata as { reportChart?: unknown }).reportChart)).toBe(
      true
    );
    expect(cells[0].value).toContain("Visible (visible, no-data)");
    expect(cells[0].value).toContain("In flight (inflight, no-data)");
  });

  it("uses the service, target, and collection time in the fixed report filename", () => {
    const filename = buildCloudWatchReportFilename(initialize, metrics);
    expect(filename).toMatch(/^metrics-sqs-orders-\d{8}-\d{6}\.dbnr$/);
    expect(
      buildCloudWatchReportFilename(
        {
          ...initialize,
          providerId: "aws.s3.overview",
          target: { ...initialize.target, displayName: "All buckets" },
        },
        metrics,
        "aws-cloudwatch-metrics-overview"
      )
    ).toMatch(/^metrics-s3-overview-All_buckets-\d{8}-\d{6}\.dbnr$/);
  });

  it("exports overview dashboard identity and derived-series metadata", () => {
    const overviewInitialize: CloudWatchDashboardInitializePayload = {
      ...initialize,
      providerId: "aws.s3.overview",
      panels: [
        {
          ...initialize.panels[0],
          queries: [],
          derivedSeries: [
            {
              id: "bucket_0_total",
              label: "archive-bucket",
              unit: "bytes",
              operation: "sum",
              inputSeriesIds: ["bucket_0_standard", "bucket_0_glacier"],
            },
          ],
        },
      ],
    };
    const overviewMetrics: CloudWatchMetricsPayload = {
      ...metrics,
      panelSeries: [
        {
          panelId: "backlog",
          series: [
            {
              id: "bucket_0_total",
              label: "archive-bucket",
              unit: "bytes",
              status: "complete",
              points: [{ x: "2026-08-29T00:00:00.000Z", y: 1024 }],
            },
          ],
        },
      ],
    };

    const data = buildCloudWatchDashboardNotebookData(
      overviewInitialize,
      overviewMetrics,
      "aws-cloudwatch-metrics-overview"
    );

    expect(data.summary[0].dashboardId).toBe("aws-cloudwatch-metrics-overview");
    expect(data.metricSeries[0]).toMatchObject({
      metricName: "derived:sum",
      statistic: "sum",
      dimensions: "[]",
    });
  });
});
