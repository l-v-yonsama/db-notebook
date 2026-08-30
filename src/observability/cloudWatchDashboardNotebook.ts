import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import {
  NotebookCellData,
  NotebookCellKind,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookData,
} from "vscode";
import type {
  PersistedReportOutputMetadata,
  ReportChartSpec,
} from "../notebook/report/reportTypes";
import type {
  CloudWatchDashboardInitializePayload,
  CloudWatchMetricsPayload,
  DashboardTimeSeries,
} from "../shared/observability";

export type CloudWatchDashboardNotebookData = {
  summary: Array<Record<string, unknown>>;
  metricSeries: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
};

function safeFilenamePart(value: string, fallback: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

export function buildCloudWatchReportFilename(
  initialize: CloudWatchDashboardInitializePayload,
  metrics: CloudWatchMetricsPayload,
  dashboardId = "aws-cloudwatch-metrics"
): string {
  const providerParts = initialize.providerId.split(".");
  const service = safeFilenamePart(providerParts[1] ?? "aws", "aws").toLowerCase();
  const overviewSuffix = dashboardId.endsWith("-overview") ? "-overview" : "";
  const target = safeFilenamePart(initialize.target.displayName, "resource");
  const collectedAt = new Date(metrics.collectedAt);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const timestamp =
    `${collectedAt.getFullYear()}${pad2(collectedAt.getMonth() + 1)}${pad2(
      collectedAt.getDate()
    )}-` +
    `${pad2(collectedAt.getHours())}${pad2(collectedAt.getMinutes())}${pad2(
      collectedAt.getSeconds()
    )}`;
  return `metrics-${service}${overviewSuffix}-${target}-${timestamp}.dbnr`;
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

function markdownCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
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

function buildResultSet(rows: Array<Record<string, unknown>>): ResultSetData {
  if (rows.length === 0) {
    return ResultSetDataBuilder.createEmpty({ noRecordsReason: "No records" }).build();
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const builder = new ResultSetDataBuilder(keys);
  rows.forEach((row) => builder.addRow(row));
  builder.resetKeyTypeByRows();
  return builder.build();
}

function persistedResultSetCell(
  rows: Array<Record<string, unknown>>,
  label: string,
  contextParts: string[],
  reportChart?: ReportChartSpec
): NotebookCellData {
  const rdh = buildResultSet(rows);
  const cell = new NotebookCellData(
    NotebookCellKind.Code,
    `Saved dashboard snapshot: ${label}. No AWS request is executed from this cell.`,
    "plaintext"
  );
  cell.metadata = {
    cellLabel: label,
    inputCollapsed: true,
    ...(reportChart ? { reportChart } : {}),
  };
  const metadata: PersistedReportOutputMetadata = {
    schemaVersion: 1,
    kind: "result-set",
    rdh,
  };
  cell.outputs = [
    new NotebookCellOutput(
      [
        NotebookCellOutputItem.text(
          [
            `### ${label}`,
            "",
            contextParts.map(markdownCode).join(" · "),
            "",
            "> Saved dashboard snapshot. No AWS request is executed from this cell.",
            "",
            `\`[Saved result]\` ${rows.length} row(s)`,
            ResultSetDataBuilder.from(rdh).toMarkdown({ maxPrintLines: 10 }),
          ].join("\n"),
          "text/markdown"
        ),
      ],
      metadata
    ),
  ];
  return cell;
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
    const chart: ReportChartSpec | undefined = ["line", "bar", "stacked-area"].includes(
      panel.visualization
    )
      ? {
          version: 1,
          renderer: "chartjs",
          type: panel.visualization as ReportChartSpec["type"],
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
      persistedResultSetCell(
        rows,
        panel.title,
        [initialize.target.displayName, panel.emission, seriesSummary],
        chart
      ),
    ];
  });

  const cells = [
    heading,
    persistedResultSetCell(data.summary, "Dashboard summary", summaryContextParts(initialize)),
    ...panelCells,
  ];
  return cells;
}

export function buildCloudWatchDashboardReport(
  initialize: CloudWatchDashboardInitializePayload,
  metrics: CloudWatchMetricsPayload,
  dashboardId = "aws-cloudwatch-metrics"
): NotebookData {
  const report = new NotebookData(
    buildCloudWatchDashboardNotebookCells(initialize, metrics, dashboardId)
  );
  report.metadata = {
    formatVersion: 1,
    reportKind: "aws-cloudwatch-metrics",
    dashboardId,
    collectedAt: metrics.collectedAt,
  };
  return report;
}
