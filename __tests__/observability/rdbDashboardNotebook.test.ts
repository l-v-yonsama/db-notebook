import type {
  RdbAccumulatedSample,
  ResolvedRdbDashboard,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCellKind } from "vscode";
import { describe, expect, it } from "vitest";
import {
  buildRdbDashboardNotebookCells,
  buildRdbDashboardNotebookData,
  buildRdbDashboardReport,
  buildRdbDashboardReportFilename,
  type RdbDashboardNotebookSnapshot,
} from "../../src/observability/rdbDashboardNotebook";

const scope = { kind: "database", label: "Database app" };
const dashboard: ResolvedRdbDashboard = {
  providerId: "rdb.postgres.database",
  variant: "postgres-16",
  definitionVersion: 2,
  target: {
    resourceKey: "runtime-only-key",
    displayName: "app",
    sourceLabel: "PostgreSQL 16",
    scope,
  },
  serverVersion: "16.4",
  samplePolicy: {
    defaultIntervalMs: 10_000,
    allowedIntervalMs: [10_000],
    maxPointsPerSeries: 360,
    maxVisibleSeriesPerPanel: 20,
    defaultTopN: 10,
    maxPayloadBytes: 2_000_000,
    queryTimeoutMs: 3_000,
    hiddenDisconnectDelayMs: 30_000,
  },
  metrics: [
    { id: "calls", label: "Calls", unit: "calls/s", scope, measurement: { kind: "gauge" } },
    { id: "waits", label: "Waits", unit: "count", scope, measurement: { kind: "gauge" } },
  ],
  capabilities: [{ sectionId: "workload", status: "available", scope }],
  tabs: [
    {
      id: "overview",
      title: "Overview",
      timeMode: "sampling-session",
      selectors: [],
      panels: [
        {
          id: "workload",
          title: "Workload",
          purpose: "workload",
          scope,
          visualization: "line",
          metricIds: ["calls", "waits"],
          sectionCapabilityId: "workload",
        },
      ],
    },
  ],
  notices: [
    { id: "observer", severity: "info", title: "Observer", message: "Observer is excluded." },
  ],
};

const accumulated: RdbAccumulatedSample = {
  sampleSessionId: "session-id-not-exported",
  definitionVersion: 2,
  sequence: 12,
  series: [
    {
      key: "calls\u001edatabase=app",
      metric: dashboard.metrics[0],
      dimensions: { database: "app" },
      points: Array.from({ length: 12 }, (_, index) => ({
        metricId: "calls",
        observedAt: `2026-08-30T00:${String(index).padStart(2, "0")}:00.000Z`,
        dimensions: { database: "app" },
        rawValue: index,
        value: index === 0 ? 0 : index,
        status: "ok" as const,
      })),
    },
    {
      key: "waits",
      metric: dashboard.metrics[1],
      points: [
        {
          metricId: "waits",
          observedAt: "2026-08-30T00:11:00.000Z",
          rawValue: null,
          value: null,
          status: "forbidden",
          messageCode: "permission-denied",
        },
      ],
    },
  ],
  resetMarkers: [
    {
      metricId: "calls",
      observedAt: "2026-08-30T00:06:00.000Z",
      epochKey: "server",
      before: "boot-1",
      after: "boot-2",
      reason: "epoch-changed",
      reasonLabel: "Server restart",
    },
  ],
  diagnostics: [
    {
      sectionId: "workload",
      severity: "warning",
      code: "partial-visibility",
      message: "Some sessions are hidden.",
    },
  ],
};

const snapshot: RdbDashboardNotebookSnapshot = {
  dashboard,
  accumulated,
  activeTabId: "overview",
  environmentLabel: "Test",
  samplingStartedAt: "2026-08-30T00:00:00.000Z",
  collectedAt: "2026-08-30T00:11:01.000Z",
  intervalMs: 10_000,
  samplingState: "stopped",
};

describe("RDB dashboard notebook export", () => {
  it("exports summary, values, dimensions, nulls, reset markers, and diagnostics", () => {
    const data = buildRdbDashboardNotebookData(snapshot);

    expect(data.summary[0]).toMatchObject({
      providerId: "rdb.postgres.database",
      target: "app",
      intervalMs: 10_000,
    });
    expect(data.metricSeries[0]).toMatchObject({ value: 0, dimensions: '{"database":"app"}' });
    expect(data.metricSeries.at(-1)).toMatchObject({ value: null, status: "forbidden" });
    expect(data.resetMarkers[0]).toMatchObject({
      epochKey: "server",
      before: "boot-1",
      after: "boot-2",
    });
    expect(data.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "partial-visibility" })])
    );
  });

  it("creates a complete metric-series evidence cell and limits panel previews to ten rows", () => {
    const cells = buildRdbDashboardNotebookCells(snapshot);

    expect(cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(cells[0].value).toContain("## Metrics without values");
    expect(cells[0].value).toContain("**Waits** (waits, forbidden)");
    const metricSeries = cells.find((cell) => cell.metadata.cellLabel === "Metric series");
    const metricRows = (metricSeries?.outputs?.[0]?.metadata as { rdh?: { rows?: unknown[] } })?.rdh
      ?.rows;
    expect(metricRows).toHaveLength(13);
    expect(JSON.stringify(metricRows)).toContain("forbidden");
    const workload = cells.find((cell) => cell.metadata.cellLabel === "Workload");
    expect(workload?.metadata.reportChart).toMatchObject({
      xAxis: { type: "time", display: "auto" },
      series: [{ label: "Calls · app" }],
    });
    const preview = String(workload?.outputs?.[0]?.items[0]?.data);
    expect(preview).toContain("2026-08-30T00:00:00.000Z");
    expect(preview).toContain("2026-08-30T00:11:00.000Z");
    expect(preview).toContain("...");
    expect(cells.some((cell) => cell.metadata.cellLabel === "Reset markers")).toBe(true);
    expect(cells.some((cell) => cell.metadata.cellLabel === "Diagnostics")).toBe(true);
  });

  it("uses the common read-only report format without runtime connection identity", () => {
    const report = buildRdbDashboardReport(snapshot);
    const serialized = JSON.stringify(report);

    expect(report.metadata).toMatchObject({ reportKind: "rdb-database" });
    expect(serialized).not.toContain("runtime-only-key");
    expect(serialized).not.toContain("session-id-not-exported");
    expect(buildRdbDashboardReportFilename(snapshot)).toMatch(
      /^metrics-postgres-app-\d{8}-\d{6}\.dbnr$/
    );
  });
});
