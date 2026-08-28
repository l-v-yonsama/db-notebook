// Display-only rounding and accessible labels for comparison evidence.

import type {
  ComparabilityLevel,
  IndexChange,
  IndexSnapshot,
  MetricAssessment,
  NumericComparison,
  PerformanceTuningComparisonEvidence,
} from "./vscode";

export type AssessmentDisplay = {
  icon: string;
  text: string;
  // Used for the row's CSS class; never the only signal (§12).
  tone: "positive" | "negative" | "neutral" | "unknown";
};

export function assessmentDisplay(assessment: MetricAssessment): AssessmentDisplay {
  switch (assessment) {
    case "improved":
      return { icon: "circle-check", text: "Improved", tone: "positive" };
    case "regressed":
      return { icon: "circle-exclamation", text: "Worse", tone: "negative" };
    case "unchanged":
      return { icon: "circle-minus", text: "No change", tone: "neutral" };
    case "changed":
      return { icon: "circle-arrow-right", text: "Changed", tone: "neutral" };
    case "noData":
      return { icon: "circle-question", text: "Only one side has a value", tone: "unknown" };
    case "notComparable":
      return { icon: "circle-question", text: "Not comparable", tone: "unknown" };
  }
}

/** Uses an actionable label for a resolvable one-sided measurement gap. */
export function metricAssessmentDisplay(metric: NumericComparison): AssessmentDisplay {
  if (metric.assessment === "noData" && metric.missingDataGuidance) {
    return {
      icon: "circle-play",
      text: metric.missingDataGuidance.action,
      tone: "unknown",
    };
  }
  return assessmentDisplay(metric.assessment);
}

export function comparabilityDisplay(level: ComparabilityLevel): AssessmentDisplay {
  switch (level) {
    case "comparable":
      return { icon: "circle-check", text: "Comparable", tone: "positive" };
    case "partiallyComparable":
      return { icon: "triangle-exclamation", text: "Partially comparable", tone: "neutral" };
    case "notComparable":
      return { icon: "circle-xmark", text: "Not comparable", tone: "unknown" };
  }
}

/** Significant-digit rounding, so both 0.0002 and 128000 stay readable. */
export function formatMetricValue(value: number | undefined, unit: string): string {
  if (value === undefined) {
    return "—";
  }
  return `${formatNumber(value)}${
    unit && unit !== "ratio" && unit !== "fraction" ? ` ${unit}` : ""
  }`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 100) {
    return value.toFixed(0);
  }
  if (magnitude >= 1) {
    return value.toFixed(2);
  }
  // Small fractions (selectivity, pass rates) lose all their meaning at two
  // decimal places, so they keep four significant digits instead.
  return Number(value.toPrecision(4)).toString();
}

/**
 * The "Change" cell. A not-comparable metric deliberately shows only the raw
 * movement (or nothing), never a rate - §11's "比較不能な指標も Baseline /
 * Current の生値は表示してよいが、改善率と良否判定を表示しない".
 */
export function formatChange(metric: NumericComparison): string {
  if (metric.comparability === "notComparable") {
    return "—";
  }
  if (metric.baseline === undefined || metric.current === undefined) {
    return "—";
  }
  const parts: string[] = [];
  if (metric.absoluteDelta !== undefined) {
    parts.push(`${metric.absoluteDelta > 0 ? "+" : ""}${formatNumber(metric.absoluteDelta)}`);
  }
  if (metric.percentagePointDelta !== undefined) {
    parts.push(
      `${metric.percentagePointDelta > 0 ? "+" : ""}${formatNumber(metric.percentagePointDelta)} pt`
    );
  } else if (metric.percentChange !== undefined) {
    parts.push(`${metric.percentChange > 0 ? "+" : ""}${formatNumber(metric.percentChange)}%`);
  }
  return parts.join(" / ");
}

/**
 * The headline figure for a metric: how much better it got, in the metric's
 * own good direction. Absent for neutral metrics and for anything the
 * evidence marked not comparable.
 */
export function formatImprovement(metric: NumericComparison): string | undefined {
  if (metric.comparability === "notComparable" || metric.improvementPercent === undefined) {
    return undefined;
  }
  const rounded = Number(metric.improvementPercent.toFixed(1));
  if (rounded === 0) {
    return undefined;
  }
  return rounded > 0 ? `${rounded}% better` : `${Math.abs(rounded)}% worse`;
}

/**
 * "Key improvements" (§12 item 2): the largest genuine moves, best first,
 * drawn only from metrics that are actually comparable and actually moved.
 */
export function keyImprovements(
  evidence: PerformanceTuningComparisonEvidence,
  limit = 5
): Array<{ metric: NumericComparison; improvement: string }> {
  return allMetrics(evidence)
    .filter(
      (metric) =>
        metric.comparability === "comparable" &&
        (metric.assessment === "improved" || metric.assessment === "regressed") &&
        metric.improvementPercent !== undefined
    )
    .sort((a, b) => Math.abs(b.improvementPercent!) - Math.abs(a.improvementPercent!))
    .slice(0, limit)
    .map((metric) => ({ metric, improvement: formatImprovement(metric) ?? "" }))
    .filter((entry) => entry.improvement !== "");
}

export function allMetrics(evidence: PerformanceTuningComparisonEvidence): NumericComparison[] {
  return [...evidence.common.workload.metrics, ...evidence.engineSpecific.value.metrics];
}

/** One-line rendering of an index definition for the changes table. */
export function describeIndexSnapshot(index: IndexSnapshot): string {
  const parts = [`${index.scope}.${index.indexName}`, `(${index.columns.join(", ")})`];
  if (index.unique) {
    parts.push("unique");
  }
  if (index.kind) {
    parts.push(index.kind);
  }
  if (index.includedColumns?.length) {
    parts.push(`include (${index.includedColumns.join(", ")})`);
  }
  if (index.predicate) {
    parts.push(`where ${index.predicate}`);
  }
  if (index.projectionType) {
    parts.push(`projection ${index.projectionType}`);
  }
  if (index.nonKeyAttributes?.length) {
    parts.push(`non-key (${index.nonKeyAttributes.join(", ")})`);
  }
  return parts.join(" ");
}

/**
 * Worded as an observation on purpose. Two Contexts are snapshots from
 * different times, so the extension can say an index was seen on one side
 * and not the other, never that someone created or dropped it (§9.1).
 */
export function describeIndexChange(change: IndexChange): {
  label: string;
  detail: string;
  icon: string;
} {
  switch (change.kind) {
    case "observedOnlyInCurrent":
      return {
        label: "Not in baseline, observed now",
        detail: describeIndexSnapshot(change.current),
        icon: "circle-plus",
      };
    case "observedOnlyInBaseline":
      return {
        label: "In baseline, not observed now",
        detail: describeIndexSnapshot(change.baseline),
        icon: "circle-minus",
      };
    case "definitionChanged":
      return {
        label: `Definition differs (${change.changedFields.join(", ")})`,
        detail: `${describeIndexSnapshot(change.baseline)} → ${describeIndexSnapshot(
          change.current
        )}`,
        icon: "circle-arrow-right",
      };
  }
}
