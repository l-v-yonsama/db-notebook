import { describe, expect, it } from "vitest";
import type { IndexSnapshot } from "../../../src/shared/PerformanceTuningComparison";
import {
  buildPerformanceTuningComparisonEvidence,
  buildQueryComparison,
  buildQuerySnapshot,
  compareIndexSnapshots,
  compareNumericMetric,
  diffLines,
  hashContext,
  resolveComparabilityLevel,
} from "../../../src/performanceTuning/comparison/performanceTuningComparison";
import { baselineOf, dynamoContext, rdbContext } from "../performanceTuningComparisonFixtures";

describe("compareNumericMetric", () => {
  const base = { key: "m", label: "Metric", unit: "ms" } as const;

  it("reports an improvement when a lower-is-better metric goes down", () => {
    const result = compareNumericMetric({
      ...base,
      direction: "lowerIsBetter",
      baseline: 400,
      current: 100,
    });

    expect(result.absoluteDelta).toBe(-300);
    expect(result.percentChange).toBe(-75);
    expect(result.improvementPercent).toBe(75);
    expect(result.assessment).toBe("improved");
    expect(result.comparability).toBe("comparable");
  });

  it("reports a regression when a lower-is-better metric goes up", () => {
    const result = compareNumericMetric({
      ...base,
      direction: "lowerIsBetter",
      baseline: 100,
      current: 400,
    });

    expect(result.percentChange).toBe(300);
    expect(result.improvementPercent).toBe(-300);
    expect(result.assessment).toBe("regressed");
  });

  it("flips the improvement sign for a higher-is-better metric", () => {
    const improved = compareNumericMetric({
      ...base,
      direction: "higherIsBetter",
      baseline: 0.2,
      current: 0.8,
    });
    const regressed = compareNumericMetric({
      ...base,
      direction: "higherIsBetter",
      baseline: 0.8,
      current: 0.2,
    });

    expect(improved.improvementPercent).toBeCloseTo(300, 10);
    expect(improved.assessment).toBe("improved");
    expect(regressed.improvementPercent).toBeCloseTo(-75, 10);
    expect(regressed.assessment).toBe("regressed");
  });

  it("never calls a neutral metric improved or regressed", () => {
    const result = compareNumericMetric({
      ...base,
      direction: "neutral",
      baseline: 10,
      current: 20,
    });

    expect(result.assessment).toBe("changed");
    expect(result.improvementPercent).toBeUndefined();
  });

  it("reports unchanged when both sides are equal", () => {
    const result = compareNumericMetric({
      ...base,
      direction: "lowerIsBetter",
      baseline: 5,
      current: 5,
    });

    expect(result.assessment).toBe("unchanged");
    expect(result.percentChange).toBe(0);
    expect(result.improvementPercent).toBe(-0);
  });

  it("produces no rate when the baseline is 0, but keeps the absolute delta", () => {
    const result = compareNumericMetric({
      ...base,
      direction: "lowerIsBetter",
      baseline: 0,
      current: 25,
    });

    expect(result.percentChange).toBeUndefined();
    expect(result.improvementPercent).toBeUndefined();
    expect(result.absoluteDelta).toBe(25);
    expect(result.assessment).toBe("regressed");
  });

  it("produces no rate when one side is missing", () => {
    const result = compareNumericMetric({ ...base, direction: "lowerIsBetter", baseline: 100 });

    expect(result.assessment).toBe("noData");
    expect(result.absoluteDelta).toBeUndefined();
    expect(result.percentChange).toBeUndefined();
  });

  it("keeps both raw values but no improvement figure when the caller rejected the metric", () => {
    const result = compareNumericMetric({
      ...base,
      direction: "lowerIsBetter",
      baseline: 400,
      current: 100,
      notComparable: "different scope",
    });

    expect(result.baseline).toBe(400);
    expect(result.current).toBe(100);
    expect(result.comparability).toBe("notComparable");
    expect(result.reason).toBe("different scope");
    expect(result.improvementPercent).toBeUndefined();
    expect(result.assessment).toBe("notComparable");
  });

  it("adds a percentage-point delta for ratio metrics, separate from percent change", () => {
    const result = compareNumericMetric({
      key: "r",
      label: "Rate",
      unit: "fraction",
      direction: "higherIsBetter",
      isRatio: true,
      baseline: 0.2,
      current: 0.5,
    });

    expect(result.percentagePointDelta).toBeCloseTo(30, 10);
    expect(result.percentChange).toBeCloseTo(150, 10);
  });

  it("keeps unrounded values in the evidence", () => {
    const result = compareNumericMetric({
      ...base,
      direction: "lowerIsBetter",
      baseline: 3,
      current: 1,
    });

    expect(result.improvementPercent).toBeCloseTo(66.66666666666667, 12);
    expect(String(result.improvementPercent)).not.toBe("66.67");
  });
});

describe("resolveComparabilityLevel", () => {
  it("takes the strongest single reason", () => {
    expect(
      resolveComparabilityLevel([
        { code: "ENVIRONMENT_MAY_DIFFER", level: "comparable", message: "" },
        { code: "QUERY_CHANGED", level: "partiallyComparable", message: "" },
      ])
    ).toBe("partiallyComparable");

    expect(
      resolveComparabilityLevel([
        { code: "QUERY_CHANGED", level: "partiallyComparable", message: "" },
        { code: "VENDOR_MISMATCH", level: "notComparable", message: "" },
      ])
    ).toBe("notComparable");
  });
});

describe("diffLines / buildQueryComparison", () => {
  it("marks only the lines that actually changed", () => {
    const { diff, diffTruncated } = diffLines("a\nb\nc", "a\nB\nc");

    expect(diffTruncated).toBe(false);
    expect(diff.map((line) => [line.kind, line.text])).toEqual([
      ["context", "a"],
      ["removed", "b"],
      ["added", "B"],
      ["context", "c"],
    ]);
  });

  it("ignores trailing whitespace and CRLF when deciding whether the query changed", () => {
    const comparison = buildQueryComparison(
      buildQuerySnapshot({ language: "sql", text: "SELECT 1\r\nFROM t  " }),
      buildQuerySnapshot({ language: "sql", text: "SELECT 1\nFROM t" })
    );

    expect(comparison.changed).toBe(false);
    expect(comparison.diff).toEqual([]);
  });

  it("hashes the text so two reports can be matched without re-reading both bodies", () => {
    const a = buildQuerySnapshot({ language: "sql", text: "SELECT 1" });
    const b = buildQuerySnapshot({ language: "sql", text: "SELECT 1" });
    const c = buildQuerySnapshot({ language: "sql", text: "SELECT 2" });

    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("compareIndexSnapshots", () => {
  const index = (overrides: Partial<IndexSnapshot> = {}): IndexSnapshot => ({
    scope: "public.orders",
    indexName: "idx_status",
    columns: ["status"],
    unique: false,
    ...overrides,
  });

  it("reports an index seen only on one side as an observation, not a creation", () => {
    const { changes, unchangedCount } = compareIndexSnapshots([], [index()]);

    expect(unchangedCount).toBe(0);
    expect(changes).toEqual([{ kind: "observedOnlyInCurrent", current: index() }]);
  });

  it("reports an index missing from the current side", () => {
    const { changes } = compareIndexSnapshots([index()], []);

    expect(changes[0].kind).toBe("observedOnlyInBaseline");
  });

  it("names the fields that changed for a same-name index", () => {
    const { changes } = compareIndexSnapshots(
      [index()],
      [index({ columns: ["status", "created_at"], unique: true })]
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "definitionChanged" });
    expect(
      changes[0].kind === "definitionChanged" ? changes[0].changedFields : []
    ).toEqual(["unique", "columns"]);
  });

  it("treats column order as part of the index identity", () => {
    const { changes } = compareIndexSnapshots(
      [index({ columns: ["a", "b"] })],
      [index({ columns: ["b", "a"] })]
    );

    expect(changes).toHaveLength(1);
  });

  it("counts an identical index as unchanged", () => {
    const { changes, unchangedCount } = compareIndexSnapshots([index()], [index()]);

    expect(changes).toEqual([]);
    expect(unchangedCount).toBe(1);
  });
});

describe("buildPerformanceTuningComparisonEvidence", () => {
  it("refuses a cross-engine pair instead of returning a not-comparable evidence", () => {
    const result = buildPerformanceTuningComparisonEvidence({
      baseline: baselineOf(rdbContext()),
      current: dynamoContext(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").toContain("across engines is not supported");
  });

  it("routes an RDB pair to the RDB builder and stamps the source metadata", () => {
    const result = buildPerformanceTuningComparisonEvidence({
      baseline: baselineOf(rdbContext()),
      current: rdbContext(),
      now: new Date("2026-08-27T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.evidence.engine).toBe("rdb");
    expect(result.evidence.generatedAt).toBe("2026-08-27T12:00:00.000Z");
    expect(result.evidence.source.baseline.fileName).toBe("baseline.dbn");
    expect(result.evidence.source.current.collectedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("routes a DynamoDB pair to the DynamoDB builder", () => {
    const result = buildPerformanceTuningComparisonEvidence({
      baseline: baselineOf(dynamoContext()),
      current: dynamoContext(),
    });

    expect(result.ok && result.evidence.engine).toBe("dynamodb");
  });
});

describe("hashContext", () => {
  it("is stable for equal contexts and differs for changed ones", () => {
    expect(hashContext(rdbContext())).toBe(hashContext(rdbContext()));
    expect(hashContext(rdbContext())).not.toBe(
      hashContext(rdbContext({ collection: { ...rdbContext().collection, status: "partial" } }))
    );
  });
});
