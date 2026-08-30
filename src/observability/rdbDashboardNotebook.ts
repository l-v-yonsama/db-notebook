import {
  RdbAccumulatedSample,
  ResolvedRdbDashboard,
  RdbProcessedSeries,
} from "@l-v-yonsama/multi-platform-database-drivers";
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
import { rdbDashboardDisplayLabels } from "./rdbDashboardDisplay";

export type RdbDashboardNotebookSnapshot = {
  dashboard: ResolvedRdbDashboard;
  accumulated: RdbAccumulatedSample;
  activeTabId?: string;
  environmentLabel?: string;
  samplingStartedAt?: string;
  collectedAt: string;
  intervalMs: number;
  samplingState: string;
};

export type RdbDashboardNotebookData = {
  summary: Array<Record<string, unknown>>;
  metricSeries: Array<Record<string, unknown>>;
  resetMarkers: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
};

function safeFilenamePart(value: string, fallback: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || fallback
  );
}

function timestampSuffix(value: string): string {
  const date = new Date(value);
  const pad2 = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

function providerVendor(providerId: string): string {
  return providerId.split(".")[1]?.toLowerCase() || "rdb";
}

function seriesLabel(series: RdbProcessedSeries): string {
  const dimensions = Object.keys(series.dimensions ?? {})
    .sort()
    .map((key) => series.dimensions?.[key])
    .filter(Boolean);
  return dimensions.length
    ? `${series.metric.label} · ${dimensions.join(" / ")}`
    : series.metric.label;
}

function markdownCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
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
    `Saved dashboard snapshot: ${label}. No database request is executed from this cell.`,
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
            "> Saved dashboard snapshot. No database request is executed from this cell.",
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

export function buildRdbDashboardReportFilename(snapshot: RdbDashboardNotebookSnapshot): string {
  const { dashboard } = snapshot;
  const targetName = rdbDashboardDisplayLabels(
    dashboard.providerId,
    dashboard.target.displayName
  ).panelTitleName;
  return `metrics-${safeFilenamePart(
    providerVendor(dashboard.providerId),
    "rdb"
  )}-${safeFilenamePart(targetName, "database")}-${timestampSuffix(snapshot.collectedAt)}.dbnr`;
}

export function buildRdbDashboardNotebookData(
  snapshot: RdbDashboardNotebookSnapshot
): RdbDashboardNotebookData {
  const { dashboard, accumulated } = snapshot;
  const metricSeries = accumulated.series.flatMap((series) =>
    series.points.map((point) => ({
      timestamp: point.observedAt,
      seriesId: series.key,
      metricId: series.metric.id,
      label: seriesLabel(series),
      dimensions: JSON.stringify(point.dimensions ?? series.dimensions ?? {}),
      value: point.value,
      rawValue: point.rawValue,
      unit: series.metric.unit,
      selfObservation: series.metric.selfObservation ?? null,
      status: point.status,
      scopeKind: series.metric.scope.kind,
      scope: series.metric.scope.label,
    }))
  );
  const resetMarkers = accumulated.resetMarkers.map((marker) => ({
    timestamp: marker.observedAt,
    metricId: marker.metricId,
    dimensions: JSON.stringify(marker.dimensions ?? {}),
    epochKey: marker.epochKey ?? null,
    before: marker.before ?? null,
    after: marker.after ?? null,
    reason: marker.reason,
    reasonLabel: marker.reasonLabel,
  }));
  const diagnostics = [
    ...accumulated.diagnostics.map((diagnostic) => ({
      section: diagnostic.sectionId,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      metricId: null,
    })),
    ...dashboard.notices.map((notice) => ({
      section: "dashboard",
      severity: notice.severity,
      code: notice.code ?? notice.id,
      message: `${notice.title}: ${notice.message}`,
      metricId: null,
    })),
  ];
  return {
    summary: [
      {
        dashboardId: "rdb-database",
        providerId: dashboard.providerId,
        variant: dashboard.variant,
        target: dashboard.target.displayName,
        vendor: providerVendor(dashboard.providerId),
        version: dashboard.serverVersion,
        environment: snapshot.environmentLabel ?? null,
        scopeKind: dashboard.target.scope.kind,
        scope: dashboard.target.scope.label,
        tab: snapshot.activeTabId ?? dashboard.tabs[0]?.id ?? null,
        samplingStartedAt: snapshot.samplingStartedAt ?? null,
        collectedAt: snapshot.collectedAt,
        intervalMs: snapshot.intervalMs,
        samplingState: snapshot.samplingState,
        definitionVersion: dashboard.definitionVersion,
      },
    ],
    metricSeries,
    resetMarkers,
    diagnostics,
  };
}

function hasValue(series: RdbProcessedSeries): boolean {
  return series.points.some((point) => point.value !== null);
}

export function buildRdbDashboardNotebookCells(
  snapshot: RdbDashboardNotebookSnapshot
): NotebookCellData[] {
  const { dashboard, accumulated } = snapshot;
  const data = buildRdbDashboardNotebookData(snapshot);
  const missingSeries = accumulated.series.filter((series) => !hasValue(series));
  const missingMarkdown =
    missingSeries.length === 0
      ? ["## Metrics without values", "", "- None."]
      : [
          "## Metrics without values",
          "",
          ...missingSeries.map((series) => {
            const status = series.points.at(-1)?.status ?? "no-data";
            return `- **${seriesLabel(series)}** (${series.metric.id}, ${status})`;
          }),
        ];
  const heading = new NotebookCellData(
    NotebookCellKind.Markup,
    [
      `# Database dashboard: ${dashboard.target.displayName}`,
      "",
      `- Source: ${dashboard.target.sourceLabel}`,
      `- Scope: ${dashboard.target.scope.label}`,
      `- Sampling started at: ${snapshot.samplingStartedAt ?? "Not recorded"}`,
      `- Collected at: ${snapshot.collectedAt}`,
      `- Sample interval: ${snapshot.intervalMs} ms`,
      `- Status: ${snapshot.samplingState}`,
      "",
      "> This notebook contains statistics already collected by Database Notebook. Running the following cells does not query the database.",
      "",
      ...missingMarkdown,
    ].join("\n"),
    "markdown"
  );
  heading.metadata = { cellLabel: "RDB dashboard snapshot" };

  const panelCells = dashboard.tabs.flatMap((tab) =>
    tab.panels.flatMap((panel) => {
      const panelSeries = accumulated.series.filter((series) =>
        panel.metricIds.includes(series.metric.id)
      );
      const displayedSeries = panelSeries.filter(hasValue);
      if (displayedSeries.length === 0) {
        return [];
      }
      const seriesKeys = new Set(displayedSeries.map((series) => series.key));
      const rows = data.metricSeries.filter((row) => seriesKeys.has(String(row.seriesId)));
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
            seriesKey: "seriesId",
            valueKey: "value",
            xAxis: { type: "time", display: "auto" },
            series: displayedSeries.map((series) => ({
              id: series.key,
              label: seriesLabel(series),
              unit: series.metric.unit,
            })),
          }
        : undefined;
      return [
        persistedResultSetCell(
          rows,
          panel.title,
          [dashboard.target.displayName, panel.scope.label, `${displayedSeries.length} series`],
          chart
        ),
      ];
    })
  );

  return [
    heading,
    persistedResultSetCell(data.summary, "Dashboard summary", [
      dashboard.target.displayName,
      dashboard.target.sourceLabel,
    ]),
    persistedResultSetCell(data.metricSeries, "Metric series", [
      dashboard.target.displayName,
      `${accumulated.series.length} series`,
    ]),
    ...panelCells,
    ...(data.resetMarkers.length
      ? [persistedResultSetCell(data.resetMarkers, "Reset markers", [dashboard.target.displayName])]
      : []),
    ...(data.diagnostics.length
      ? [persistedResultSetCell(data.diagnostics, "Diagnostics", [dashboard.target.displayName])]
      : []),
  ];
}

export function buildRdbDashboardReport(snapshot: RdbDashboardNotebookSnapshot): NotebookData {
  const report = new NotebookData(buildRdbDashboardNotebookCells(snapshot));
  report.metadata = {
    formatVersion: 1,
    reportKind: "rdb-database",
    dashboardId: "rdb-database",
    collectedAt: snapshot.collectedAt,
  };
  return report;
}
