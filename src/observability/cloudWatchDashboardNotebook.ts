import { NotebookCellData, NotebookCellKind, NotebookData } from "vscode";
import type { ReportChartSpec } from "../notebook/report/reportTypes";
import type {
  CloudWatchDashboardInitializePayload,
  CloudWatchMetricsPayload,
  DashboardTimeSeries,
} from "../shared/observability";
import { isDashboardChartVisualization } from "../shared/observability";
import {
  createDashboardReportNotebook,
  createPersistedDashboardResultSetCell,
  dashboardTimestampSuffix,
  sanitizeDashboardFilenamePart,
} from "./report/dashboardReportUtil";

export type CloudWatchDashboardNotebookData = {
  summary: Array<Record<string, unknown>>;
  metricSeries: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
};

export function buildCloudWatchReportFilename(
  initialize: CloudWatchDashboardInitializePayload,
  metrics: CloudWatchMetricsPayload,
  dashboardId = "aws-cloudwatch-metrics"
): string {
  const providerParts = initialize.providerId.split(".");
  const service = sanitizeDashboardFilenamePart(providerParts[1] ?? "aws", "aws").toLowerCase();
  const overviewSuffix = dashboardId.endsWith("-overview") ? "-overview" : "";
  const target = sanitizeDashboardFilenamePart(initialize.target.displayName, "resource");
  return `metrics-${service}${overviewSuffix}-${target}-${dashboardTimestampSuffix(
    metrics.collectedAt
  )}.dbnr`;
}

type MetricExportDefinition = {
  metricName: string;
  statistic: string;
  dimensions: Readonly<
    CloudWatchDashboardInitializePayload["panels"][number]["queries"][number]["dimensions"]
  >;
};

function diagnosticSeverity(status: DashboardTimeSeries["status"]): "info" | "warning" | "error" {
  if (["failed", "forbidden", "unavailable"].includes(status)) {
    return "error";
  }
  return status === "partial" ? "warning" : "info";
}

function hasObservedMetricValue(series: DashboardTimeSeries): boolean {
  return series.points.some((point) => point.y !== null);
}

function summaryContextParts(initialize: CloudWatchDashboardInitializePayload): string[] {
  const sourceParts = initialize.target.sourceLabel
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (sourceParts[0]?.toLowerCase() === "cloudwatch") {
    sourceParts.shift();
  }
  return [initialize.target.displayName, ...sourceParts];
}

/** Builds static, credential-free evidence from the dashboard state currently shown to the user. */
export function buildCloudWatchDashboardNotebookData(
  initialize: CloudWatchDashboardInitializePayload,
  metrics: CloudWatchMetricsPayload,
  dashboardId = "aws-cloudwatch-metrics"
): CloudWatchDashboardNotebookData {
  const queries = new Map<string, MetricExportDefinition>(
    initialize.panels.flatMap((panel) => [
      ...panel.queries.map(
        (query) =>
          [
            query.id,
            {
              metricName: query.metricName,
              statistic: query.statistic,
              dimensions: query.dimensions,
            },
          ] as const
      ),
      ...(panel.derivedSeries ?? []).map(
        (series) =>
          [
            series.id,
            {
              metricName: `derived:${series.operation}`,
              statistic: series.operation,
              dimensions: [],
            },
          ] as const
      ),
    ])
  );
  const metricSeries: Array<Record<string, unknown>> = [];
  const diagnostics: Array<Record<string, unknown>> = [];

  for (const panelResult of metrics.panelSeries) {
    for (const series of panelResult.series) {
      const query = queries.get(series.id);
      for (const point of series.points) {
        metricSeries.push({
          timestamp: point.x,
          panelId: panelResult.panelId,
          metricId: series.id,
          metricName: query?.metricName ?? series.id,
          statistic: query?.statistic ?? null,
          seriesName: series.label,
          value: point.y,
          unit: series.unit,
          status: series.status,
          dimensions: JSON.stringify(query?.dimensions ?? []),
        });
      }

      if (series.status !== "complete") {
        const entries = series.diagnostics?.length ? series.diagnostics : [{}];
        for (const entry of entries) {
          diagnostics.push({
            section: panelResult.panelId,
            severity: diagnosticSeverity(series.status),
            code: entry.code ?? series.status,
            message:
              entry.message ?? `Series '${series.label}' finished with status '${series.status}'.`,
            metricId: series.id,
          });
        }
      }
    }
  }

  for (const notice of initialize.notices) {
    diagnostics.push({
      section: "dashboard",
      severity: notice.severity,
      code: notice.code ?? notice.id,
      message: `${notice.title}: ${notice.message}`,
      metricId: null,
    });
  }

  return {
    summary: [
      {
        dashboardId,
        providerId: initialize.providerId,
        variant: initialize.variant,
        target: initialize.target.displayName,
        source: initialize.target.sourceLabel,
        environment: initialize.target.environmentLabel ?? null,
        scopeKind: initialize.target.scope.kind,
        scope: initialize.target.scope.label,
        tab: initialize.activeTabId,
        range: initialize.range,
        periodSeconds: metrics.periodSeconds,
        collectedAt: metrics.collectedAt,
        status: metrics.status,
        seriesPerRefresh: initialize.queryCount,
      },
    ],
    metricSeries,
    diagnostics,
  };
}

export function buildCloudWatchDashboardNotebookCells(
  initialize: CloudWatchDashboardInitializePayload,
  metrics: CloudWatchMetricsPayload,
  dashboardId = "aws-cloudwatch-metrics"
): NotebookCellData[] {
  const data = buildCloudWatchDashboardNotebookData(initialize, metrics, dashboardId);
  const panelById = new Map(initialize.panels.map((panel) => [panel.id, panel]));
  const missingSeriesByPanel = metrics.panelSeries
    .map((panelResult) => ({
      panel: panelById.get(panelResult.panelId),
      series: panelResult.series.filter((series) => !hasObservedMetricValue(series)),
    }))
    .filter((item) => item.series.length > 0);
  const missingMetricsMarkdown =
    missingSeriesByPanel.length === 0
      ? ["## Metrics without datapoints", "", "- None."]
      : [
          "## Metrics without datapoints",
          "",
          ...missingSeriesByPanel.flatMap(({ panel, series }) => [
            `- **${panel?.title ?? "Unknown panel"}**`,
            ...series.map((item) => {
              const reason =
                item.diagnostics
                  ?.map((diagnostic) => diagnostic.message)
                  .filter(Boolean)
                  .join("; ") ||
                panel?.emptyHint ||
                "CloudWatch returned no datapoints for the selected time range.";
              return `  - ${item.label} (${item.id}, ${item.status}): ${reason}`;
            }),
          ]),
        ];
  const noticesMarkdown =
    initialize.notices.length === 0
      ? []
      : [
          "",
          "## Collection notices",
          "",
          ...initialize.notices.map(
            (notice) => `- **${notice.title}** (${notice.severity}): ${notice.message}`
          ),
        ];
  const heading = new NotebookCellData(
    NotebookCellKind.Markup,
    [
      `# CloudWatch metrics: ${initialize.target.displayName}`,
      "",
      `- Source: ${initialize.target.sourceLabel}`,
      `- Scope: ${initialize.target.scope.label}`,
      `- Collected at: ${metrics.collectedAt}`,
      `- Status: ${metrics.status}`,
      `- Cost indicator: ${initialize.queryCount} series per refresh`,
      "",
      "> This notebook contains the dashboard snapshot already collected by Database Notebook. Running the following cells does not call AWS.",
      "",
      ...missingMetricsMarkdown,
      ...noticesMarkdown,
    ].join("\n"),
    "markdown"
  );
  heading.metadata = { cellLabel: "CloudWatch dashboard snapshot" };

  const panelCells = initialize.panels.flatMap((panel) => {
    const panelSeries = metrics.panelSeries.find((item) => item.panelId === panel.id)?.series ?? [];
    const displayedSeries = panelSeries.filter(hasObservedMetricValue);
    if (displayedSeries.length === 0) {
      return [];
    }
    const displayedSeriesIds = new Set(displayedSeries.map((series) => series.id));
    const rows = data.metricSeries.filter(
      (row) => row.panelId === panel.id && displayedSeriesIds.has(String(row.metricId))
    );
    const chart: ReportChartSpec | undefined = isDashboardChartVisualization(panel.visualization)
      ? {
          version: 1,
          renderer: "chartjs",
          type: panel.visualization,
          title: panel.title,
          dataShape: "long",
          xKey: "timestamp",
          seriesKey: "metricId",
          valueKey: "value",
          xAxis: { type: "time", display: "auto" },
          series: displayedSeries.map((series) => ({
            id: series.id,
            label: series.label,
            unit: series.unit,
          })),
        }
      : undefined;
    const seriesSummary =
      displayedSeries.length === panelSeries.length
        ? `${displayedSeries.length} series`
        : `${displayedSeries.length} of ${panelSeries.length} series with datapoints`;
    return [
      createPersistedDashboardResultSetCell({
        rows,
        label: panel.title,
        contextParts: [initialize.target.displayName, panel.emission, seriesSummary],
        requestSourceLabel: "AWS",
        reportChart: chart,
      }),
    ];
  });

  const cells = [
    heading,
    createPersistedDashboardResultSetCell({
      rows: data.summary,
      label: "Dashboard summary",
      contextParts: summaryContextParts(initialize),
      requestSourceLabel: "AWS",
    }),
    ...panelCells,
  ];
  return cells;
}

export function buildCloudWatchDashboardReport(
  initialize: CloudWatchDashboardInitializePayload,
  metrics: CloudWatchMetricsPayload,
  dashboardId = "aws-cloudwatch-metrics"
): NotebookData {
  return createDashboardReportNotebook(
    buildCloudWatchDashboardNotebookCells(initialize, metrics, dashboardId),
    {
      reportKind: "aws-cloudwatch-metrics",
      dashboardId,
      collectedAt: metrics.collectedAt,
    }
  );
}
