import type {
  RdbAccumulatedSample,
  ResolvedRdbDashboard,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  toRdbDashboardInitializePayload,
  toRdbDashboardSeriesPayload,
} from "../../src/observability/rdbDashboardPresenter";

const dashboard: ResolvedRdbDashboard = {
  providerId: "rdb.postgres.database",
  variant: "postgres-16",
  definitionVersion: 1,
  target: {
    resourceKey: "runtime",
    displayName: "app",
    sourceLabel: "PostgreSQL 16",
    scope: { kind: "database", label: "Database app" },
  },
  serverVersion: "16",
  samplePolicy: {
    defaultIntervalMs: 10_000,
    allowedIntervalMs: [5_000, 10_000],
    maxPointsPerSeries: 100,
    maxVisibleSeriesPerPanel: 2,
    defaultTopN: 2,
    maxPayloadBytes: 100_000,
    queryTimeoutMs: 3_000,
    hiddenDisconnectDelayMs: 30_000,
  },
  metrics: [
    {
      id: "calls",
      label: "Calls",
      unit: "calls/s",
      scope: { kind: "database", label: "Database app" },
      measurement: {
        kind: "cumulative-counter",
        epochKey: "stats",
        presentation: "rate",
      },
      selfObservation: "included",
    },
  ],
  capabilities: [
    {
      sectionId: "workload",
      status: "partial",
      scope: { kind: "database", label: "Database app" },
      message: "Visibility is limited.",
    },
  ],
  tabs: [
    {
      id: "overview",
      title: "Overview",
      timeMode: "sampling-session",
      selectors: [],
      panels: [
        {
          id: "calls",
          title: "Calls",
          purpose: "workload",
          scope: { kind: "database", label: "Database app" },
          visualization: "line",
          metricIds: ["calls"],
          sectionCapabilityId: "workload",
          drilldownActions: [
            {
              id: "queries",
              label: "Open query statistics",
              kind: "open-query-statistics",
              enabled: true,
            },
          ],
        },
      ],
    },
  ],
  notices: [],
};

function accumulated(status: "warming-up" | "ok" | "reset"): RdbAccumulatedSample {
  return {
    sampleSessionId: "sample",
    definitionVersion: 1,
    sequence: 0,
    series: [
      {
        key: "calls",
        metric: dashboard.metrics[0],
        points: [
          {
            metricId: "calls",
            observedAt: "2026-08-30T00:00:00.000Z",
            rawValue: 100,
            value: status === "ok" ? 2 : null,
            status,
          },
        ],
      },
    ],
    resetMarkers:
      status === "reset"
        ? [
            {
              metricId: "calls",
              observedAt: "2026-08-30T00:00:00.000Z",
              epochKey: "stats",
              before: "a",
              after: "b",
              reason: "epoch-changed",
              reasonLabel: "Statistics reset",
            },
          ]
        : [],
    diagnostics: [],
  };
}

describe("rdbDashboardPresenter", () => {
  it("maps source semantics into the common dashboard presentation", () => {
    const value = toRdbDashboardInitializePayload({
      dashboard,
      environmentLabel: "Test",
    });
    expect(value).toMatchObject({
      providerId: "rdb.postgres.database",
      definitionVersion: 1,
      status: "partial",
      target: { environmentLabel: "Test" },
      panels: [
        {
          id: "calls",
          sectionStatus: "partial",
          sectionMessage: "Visibility is limited.",
          drilldownActions: [{ id: "queries" }],
        },
      ],
    });
  });

  it("compacts SQLite file paths for display while preserving the full path for hover", () => {
    const databasePath =
      "/Users/example/Library/Application Support/Code/User/globalStorage/example.database-notebook/sqlite-demo/demo.sqlite";
    const sqliteDashboard: ResolvedRdbDashboard = {
      ...dashboard,
      providerId: "rdb.sqlite.database",
      target: {
        ...dashboard.target,
        displayName: databasePath,
        sourceLabel: "SQLite 3.49.1",
        scope: { kind: "attached-database", label: `Selected file ${databasePath}` },
      },
      tabs: dashboard.tabs.map((tab) => ({
        ...tab,
        panels: tab.panels.map((panel) => ({
          ...panel,
          scope: { kind: "attached-database", label: `Selected file ${databasePath}` },
        })),
      })),
    };

    const value = toRdbDashboardInitializePayload({ dashboard: sqliteDashboard });

    expect(value.target.displayName).toHaveLength(80);
    expect(value.target.displayName).toBe(`…${databasePath.slice(-79)}`);
    expect(value.target.fullDisplayName).toBe(databasePath);
    expect(value.target.scope).toMatchObject({
      label: "demo.sqlite",
      fullLabel: `Selected file ${databasePath}`,
    });
    expect(value.panels[0].scope).toMatchObject({
      label: "demo.sqlite",
      fullLabel: `Selected file ${databasePath}`,
    });
  });

  it("preserves warm-up and reset meaning without converting null to zero", () => {
    const warmup = toRdbDashboardSeriesPayload({
      dashboard,
      accumulated: accumulated("warming-up"),
      collectedAt: "2026-08-30T00:00:01.000Z",
    });
    expect(warmup.panelSeries[0].series[0]).toMatchObject({
      status: "no-data",
      selfObservation: "included",
      points: [{ y: null }],
      diagnostics: [{ code: "warming-up" }],
    });

    const reset = toRdbDashboardSeriesPayload({
      dashboard,
      accumulated: accumulated("reset"),
      collectedAt: "2026-08-30T00:00:02.000Z",
    });
    expect(reset.resetMarkers).toEqual([
      expect.objectContaining({ metricId: "calls", reasonLabel: "Statistics reset" }),
    ]);
    expect(reset.panelSeries[0].series[0].points[0].y).toBeNull();
  });

  it("keeps selected series in stable key order and surfaces a latest collection failure", () => {
    const failed = accumulated("ok");
    failed.series[0].points.push({
      metricId: "calls",
      observedAt: "2026-08-30T00:00:10.000Z",
      rawValue: null,
      value: null,
      status: "failed",
    });
    failed.series.push(
      {
        ...failed.series[0],
        key: "z-series",
        points: [{ ...failed.series[0].points[0], rawValue: 100, value: 100, status: "ok" }],
      },
      {
        ...failed.series[0],
        key: "a-series",
        points: [{ ...failed.series[0].points[0], rawValue: 1, value: 1, status: "ok" }],
      }
    );

    const value = toRdbDashboardSeriesPayload({
      dashboard: {
        ...dashboard,
        samplePolicy: { ...dashboard.samplePolicy, maxVisibleSeriesPerPanel: 3 },
      },
      accumulated: failed,
      collectedAt: "2026-08-30T00:00:11.000Z",
    });

    expect(value.panelSeries[0].series.map((series) => series.id)).toEqual([
      "a-series",
      "calls",
      "z-series",
    ]);
    expect(value.panelSeries[0].series[1].status).toBe("failed");
  });

  it("preserves the panel metric order before ordering dimensions by series key", () => {
    const waitsMetric = {
      ...dashboard.metrics[0],
      id: "waits",
      label: "Waits",
    };
    const orderedDashboard: ResolvedRdbDashboard = {
      ...dashboard,
      metrics: [dashboard.metrics[0], waitsMetric],
      tabs: dashboard.tabs.map((tab) => ({
        ...tab,
        panels: tab.panels.map((panel) => ({
          ...panel,
          metricIds: ["waits", "calls"],
        })),
      })),
    };
    const value = toRdbDashboardSeriesPayload({
      dashboard: orderedDashboard,
      accumulated: {
        ...accumulated("ok"),
        series: [
          accumulated("ok").series[0],
          {
            key: "waits",
            metric: waitsMetric,
            points: [
              {
                metricId: "waits",
                observedAt: "2026-08-30T00:00:00.000Z",
                rawValue: 1,
                value: 1,
                status: "ok",
              },
            ],
          },
        ],
      },
      collectedAt: "2026-08-30T00:00:01.000Z",
    });

    expect(value.panelSeries[0].series.map((series) => series.id)).toEqual(["waits", "calls"]);
  });
});
