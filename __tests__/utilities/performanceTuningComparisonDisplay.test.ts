// Rounding stays display-only and every verdict includes text plus an icon.

import { describe, expect, it } from "vitest";
import type { NumericComparison } from "../../src/shared/PerformanceTuningComparison";
import { buildRdbComparison } from "../../src/utilities/rdbPerformanceTuningComparison";
import {
  assessmentDisplay,
  comparabilityDisplay,
  describeIndexChange,
  formatChange,
  formatImprovement,
  formatMetricValue,
  keyImprovements,
  metricAssessmentDisplay,
} from "../../webview-ui/src/utilities/performanceTuningComparisonDisplay";
import { rdbContext } from "./performanceTuningComparisonFixtures";

function metric(overrides: Partial<NumericComparison> = {}): NumericComparison {
  return {
    key: "m",
    label: "Metric",
    unit: "ms",
    direction: "lowerIsBetter",
    comparability: "comparable",
    assessment: "improved",
    baseline: 400,
    current: 100,
    absoluteDelta: -300,
    percentChange: -75,
    improvementPercent: 75,
    ...overrides,
  };
}

describe("assessmentDisplay / comparabilityDisplay", () => {
  it("pairs every verdict with an icon so color is never the only signal", () => {
    for (const assessment of [
      "improved",
      "regressed",
      "unchanged",
      "changed",
      "noData",
      "notComparable",
    ] as const) {
      const display = assessmentDisplay(assessment);
      expect(display.icon).not.toBe("");
      expect(display.text).not.toBe("");
    }
    for (const level of ["comparable", "partiallyComparable", "notComparable"] as const) {
      expect(comparabilityDisplay(level).icon).not.toBe("");
      expect(comparabilityDisplay(level).text).not.toBe("");
    }
  });

  it("uses actionable Benchmark guidance instead of the generic one-sided label", () => {
    const display = metricAssessmentDisplay(metric({
      assessment: "noData",
      current: undefined,
      missingDataGuidance: {
        action: "Run Benchmark (3 runs) for Current",
        detail: "Current has no benchmark.",
      },
    }));

    expect(display).toMatchObject({
      icon: "circle-play",
      text: "Run Benchmark (3 runs) for Current",
    });
  });
});

describe("formatMetricValue", () => {
  it("keeps small fractions legible instead of rounding them to zero", () => {
    expect(formatMetricValue(0.0002, "fraction")).toBe("0.0002");
  });

  it("drops decimals on large values and appends the unit", () => {
    expect(formatMetricValue(128000.4, "rows")).toBe("128000 rows");
    expect(formatMetricValue(12.345, "ms")).toBe("12.35 ms");
  });

  it("renders a missing side as an em dash rather than 0", () => {
    expect(formatMetricValue(undefined, "ms")).toBe("—");
  });
});

describe("formatChange / formatImprovement", () => {
  it("shows the absolute delta and the rate for a comparable metric", () => {
    expect(formatChange(metric())).toBe("-300 / -75%");
    expect(formatImprovement(metric())).toBe("75% better");
  });

  it("prefers percentage points over a percent-of-a-percent for ratio metrics", () => {
    const rate = metric({
      unit: "fraction",
      direction: "higherIsBetter",
      baseline: 0.002,
      current: 1,
      absoluteDelta: 0.998,
      percentChange: 49900,
      improvementPercent: 49900,
      percentagePointDelta: 99.8,
    });

    // The 49900% rate of change is deliberately not what gets shown.
    expect(formatChange(rate)).toBe("+0.998 / +99.80 pt");
    expect(formatChange(rate)).not.toContain("49900");
  });

  it("never shows a change or an improvement for a rejected metric", () => {
    const rejected = metric({
      comparability: "notComparable",
      assessment: "notComparable",
      reason: "different scope",
    });

    expect(formatChange(rejected)).toBe("—");
    expect(formatImprovement(rejected)).toBeUndefined();
  });

  it("shows no improvement figure when only one side has a value", () => {
    const oneSided = metric({
      current: undefined,
      absoluteDelta: undefined,
      percentChange: undefined,
      improvementPercent: undefined,
      assessment: "noData",
    });

    expect(formatChange(oneSided)).toBe("—");
    expect(formatImprovement(oneSided)).toBeUndefined();
  });

  it("labels a regression as worse rather than a negative improvement", () => {
    expect(formatImprovement(metric({ improvementPercent: -300, assessment: "regressed" }))).toBe(
      "300% worse"
    );
  });
});

describe("keyImprovements", () => {
  it("ranks the biggest comparable moves first and ignores rejected ones", () => {
    const evidence = buildRdbComparison({
      baseline: rdbContext(),
      current: rdbContext({
        executionPlan: {
          mode: "analyze",
          format: "json",
          planningTimeMs: 1.2,
          executionTimeMs: 8,
          normalizedPlan: {
            id: "n1",
            depth: 0,
            operation: "Index Scan",
            relation: { schemaName: "public", tableName: "orders" },
            indexName: "idx_orders_status",
            estimated: { rows: 20, totalCost: 12 },
            actual: { rows: 20, totalMs: 8, loops: 1 },
            buffers: { hit: 40, read: 4, written: 0 },
            temp: { read: 0, written: 0 },
            children: [],
          },
          dominantCostPlanNode: { planNodeId: "n1", metric: "actual", exclusiveValue: 8 },
        },
      }),
      source: {
        baseline: {
          fileName: "baseline.dbn",
          contextSha256: "0".repeat(64),
          selectedAt: "2026-08-27T00:00:00.000Z",
        },
        current: { collectedAt: "2026-08-06T00:00:00.000Z" },
      },
      generatedAt: "2026-08-27T00:00:00.000Z",
    });

    const top = keyImprovements(evidence);

    expect(top.length).toBeGreaterThan(0);
    expect(top.every((entry) => entry.metric.comparability === "comparable")).toBe(true);
    expect(top.every((entry) => entry.improvement !== "")).toBe(true);
    // Sorted by magnitude, strongest first.
    const magnitudes = top.map((entry) => Math.abs(entry.metric.improvementPercent!));
    expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
  });
});

describe("describeIndexChange", () => {
  const index = {
    scope: "public.orders",
    indexName: "idx_status",
    columns: ["status"],
    unique: false,
  };

  it("words a one-sided index as an observation, never as a creation", () => {
    const added = describeIndexChange({ kind: "observedOnlyInCurrent", current: index });
    const removed = describeIndexChange({ kind: "observedOnlyInBaseline", baseline: index });

    expect(added.label).toBe("Not in baseline, observed now");
    expect(removed.label).toBe("In baseline, not observed now");
    for (const word of ["created", "added", "dropped", "deleted"]) {
      expect(added.label.toLowerCase()).not.toContain(word);
      expect(removed.label.toLowerCase()).not.toContain(word);
    }
  });

  it("names the fields that differ for a same-name index", () => {
    const changed = describeIndexChange({
      kind: "definitionChanged",
      baseline: index,
      current: { ...index, columns: ["status", "created_at"] },
      changedFields: ["columns"],
    });

    expect(changed.label).toBe("Definition differs (columns)");
    expect(changed.detail).toContain("→");
  });
});
