import { describe, expect, test } from "vitest";
import {
  dashboardObserverCaveat,
  dashboardSeriesColor,
  dashboardSeriesDelta,
  isDashboardSeriesWarmup,
  latestDashboardValue,
} from "../../webview-ui/src/utilities/dashboardSeries";
import type { DashboardTimeSeries } from "../../src/shared/observability";

function createSeries(overrides: Partial<DashboardTimeSeries> = {}): DashboardTimeSeries {
  return {
    id: "queries",
    label: "Queries",
    unit: "count/s",
    points: [
      { x: "2026-08-31T00:00:00.000Z", y: 2 },
      { x: "2026-08-31T00:00:10.000Z", y: 5 },
    ],
    status: "complete",
    ...overrides,
  };
}

describe("dashboard series utilities", () => {
  test("reads the latest value and calculates change from the previous observed value", () => {
    const series = createSeries({
      points: [
        { x: "2026-08-31T00:00:00.000Z", y: 2 },
        { x: "2026-08-31T00:00:10.000Z", y: null },
        { x: "2026-08-31T00:00:20.000Z", y: 5 },
      ],
    });

    expect(latestDashboardValue(series)).toBe(5);
    expect(dashboardSeriesDelta(series)).toBe(3);
  });

  test("detects rate-series warmup only when all values are unavailable", () => {
    const warmup = createSeries({
      points: [{ x: "2026-08-31T00:00:00.000Z", y: null }],
      diagnostics: [{ code: "warming-up" }],
    });

    expect(isDashboardSeriesWarmup([warmup])).toBe(true);
    expect(isDashboardSeriesWarmup([warmup, createSeries()])).toBe(false);
  });

  test("summarizes observer impact and assigns stable series colors", () => {
    const included = createSeries({ selfObservation: "included" });
    const unknown = createSeries({ id: "locks", label: "Locks", selfObservation: "unknown" });

    expect(dashboardObserverCaveat([included, unknown])).toBe(
      "Observer impact is included for Queries; unknown for Locks."
    );
    expect(dashboardSeriesColor("queries")).toBe(dashboardSeriesColor("queries"));
    expect(dashboardSeriesColor("queries", 0.2)).toMatch(/^hsla\(.+, 0\.2\)$/);
  });
});
