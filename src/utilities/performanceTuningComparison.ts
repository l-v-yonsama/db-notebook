// Deterministic comparison primitives shared by the RDB and DynamoDB
// comparison builders
// (misc/specs/performance-tuning-baseline-comparison-implementation-plan.ja.md
// §7, §8, §9, §10, §11), plus the top-level dispatcher that turns a Baseline
// selection plus the Current Context into a PerformanceTuningComparisonEvidence.
//
// Everything here is a pure function: no VS Code API, no file I/O, no webview
// (§16 Phase 1). `crypto`'s createHash is the only Node dependency, matching
// how the rest of the extension hashes (HarFilePanel.ts, MdhViewProvider.ts).

import { createHash } from "crypto";
import {
  isDynamoDbPerformanceTuningContext,
  type DynamoDbPerformanceTuningContext,
  type PerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  AnyTuningContext,
  ComparabilityLevel,
  ComparisonReason,
  ComparisonValue,
  IndexChange,
  IndexSnapshot,
  MetricAssessment,
  MetricComparability,
  MetricDirection,
  NumericComparison,
  PerformanceTuningBaselineSelection,
  PerformanceTuningComparisonEvidence,
  QueryComparison,
  QueryDiffLine,
  QuerySnapshot,
} from "../shared/PerformanceTuningComparison";
import { buildDynamoDbComparison } from "./dynamoDbPerformanceTuningComparison";
import { buildRdbComparison } from "./rdbPerformanceTuningComparison";

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Hash of the extracted Context, not of the whole .dbn file - the Context is
 * what the comparison actually consumed, so it is what a later reader needs
 * to confirm (§6.3). Uses the same 2-space JSON the Notebook cell itself
 * holds so a reader can reproduce the digest from the saved cell by hand.
 */
export function hashContext(context: AnyTuningContext): string {
  return sha256Hex(JSON.stringify(context, null, 2));
}

// ---------------------------------------------------------------------------
// Values (§7)
// ---------------------------------------------------------------------------

export function compareValue<T>(
  baseline: T | undefined,
  current: T | undefined,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b
): ComparisonValue<T> {
  const changed =
    baseline === undefined || current === undefined
      ? baseline !== current
      : !isEqual(baseline, current);
  return { baseline, current, changed };
}

export function compareStringListValue(
  baseline: string[] | undefined,
  current: string[] | undefined
): ComparisonValue<string[]> {
  return compareValue(baseline, current, (a, b) => a.join("\u0000") === b.join("\u0000"));
}

// ---------------------------------------------------------------------------
// Numbers (§10.1)
// ---------------------------------------------------------------------------

export type NumericMetricInput = {
  key: string;
  label: string;
  unit: string;
  direction: MetricDirection;
  baseline?: number;
  current?: number;
  // Set for metrics that are themselves fractions/rates. Their honest delta
  // is a difference of two rates (percentage points), not a "percent change
  // of a percent" (§10.1).
  isRatio?: boolean;
  // Pre-decided rejection - unit/scope/source/aggregation mismatch, a
  // CloudWatch `noData` series, a one-sided bounded observation, and so on.
  // Set this rather than dropping the metric: §11 says a not-comparable
  // metric may still show both raw values, just no improvement figure.
  notComparable?: string;
};

/**
 * The single place a percentage is ever produced. Refuses to divide when the
 * baseline is 0, when either side is missing, or when the caller already
 * rejected the metric - in each of those cases the raw values still travel
 * so the Preview can show them without an improvement figure (§10.1).
 *
 * No rounding happens here. Evidence JSON keeps the unrounded computation and
 * display code rounds at render time (§10.1's closing rule).
 */
export function compareNumericMetric(input: NumericMetricInput): NumericComparison {
  const { key, label, unit, direction, baseline, current, isRatio, notComparable } = input;
  const base: NumericComparison = {
    key,
    label,
    baseline,
    current,
    unit,
    direction,
    comparability: notComparable ? "notComparable" : "comparable",
    reason: notComparable,
    assessment: "notComparable",
  };

  if (notComparable) {
    return base;
  }
  if (baseline === undefined || current === undefined) {
    return { ...base, assessment: "noData" };
  }

  const absoluteDelta = current - baseline;
  const percentagePointDelta = isRatio ? absoluteDelta * 100 : undefined;
  // A 0 baseline has no meaningful rate of change (§10.1) - the absolute
  // delta above is still honest and still shown.
  const percentChange = baseline === 0 ? undefined : (absoluteDelta / Math.abs(baseline)) * 100;
  const improvementPercent =
    percentChange === undefined || direction === "neutral"
      ? undefined
      : direction === "lowerIsBetter"
        ? -percentChange
        : percentChange;

  return {
    ...base,
    absoluteDelta,
    percentChange,
    improvementPercent,
    percentagePointDelta,
    assessment: assessMetric(direction, baseline, current),
  };
}

function assessMetric(
  direction: MetricDirection,
  baseline: number,
  current: number
): MetricAssessment {
  if (baseline === current) {
    return "unchanged";
  }
  if (direction === "neutral") {
    return "changed";
  }
  const better = direction === "lowerIsBetter" ? current < baseline : current > baseline;
  return better ? "improved" : "regressed";
}

/** Drops metrics that have no value on either side, so tables stay readable. */
export function withoutEmptyMetrics(metrics: NumericComparison[]): NumericComparison[] {
  return metrics.filter((m) => m.baseline !== undefined || m.current !== undefined);
}

export function toMetricDecisions(metrics: NumericComparison[]): MetricComparability[] {
  return metrics.map(({ key, comparability, reason }) => ({
    metricKey: key,
    comparability,
    reason,
  }));
}

// ---------------------------------------------------------------------------
// Comparability (§11)
// ---------------------------------------------------------------------------

const LEVEL_RANK: Record<ComparabilityLevel, number> = {
  comparable: 0,
  partiallyComparable: 1,
  notComparable: 2,
};

/** The overall level is the strongest single reason present (§11). */
export function resolveComparabilityLevel(reasons: ComparisonReason[]): ComparabilityLevel {
  return reasons.reduce<ComparabilityLevel>(
    (worst, reason) => (LEVEL_RANK[reason.level] > LEVEL_RANK[worst] ? reason.level : worst),
    "comparable"
  );
}

export function hasBlockingReason(reasons: ComparisonReason[]): boolean {
  return reasons.some((reason) => reason.level === "notComparable");
}

/**
 * Propagates a whole-comparison `notComparable` verdict down to every metric.
 *
 * Without this, a per-metric decision stays `comparable` on its own terms even
 * when the two sides are a different vendor, database, or table - and every
 * downstream consumer (the Preview's Key changes, the report's key-changes
 * table, the AI Comparison Input) keys off the per-metric flag alone, so a
 * cross-database pair would still headline "95% better". §11 and completion
 * criterion 3 both require the opposite: a comparison that cannot be made at
 * all must show no improvement figure anywhere.
 *
 * Both raw values survive, since §11 explicitly still allows showing them; only
 * the derived comparison (delta, rates, verdict) is dropped.
 */
export function applyBlockingComparability(
  metrics: NumericComparison[],
  reasons: ComparisonReason[]
): NumericComparison[] {
  const blocking = reasons.filter((reason) => reason.level === "notComparable");
  if (blocking.length === 0) {
    return metrics;
  }
  const reason = `The two sides cannot be compared at all: ${blocking
    .map((r) => r.message)
    .join(" ")}`;
  return metrics.map((metric) => ({
    key: metric.key,
    label: metric.label,
    baseline: metric.baseline,
    current: metric.current,
    unit: metric.unit,
    direction: metric.direction,
    comparability: "notComparable",
    // A metric-specific reason is the more precise one, so it wins.
    reason: metric.reason ?? reason,
    assessment: "notComparable",
  }));
}

// ---------------------------------------------------------------------------
// Query text and diff (§8.1)
// ---------------------------------------------------------------------------

export function buildQuerySnapshot(params: {
  language: QuerySnapshot["language"];
  text?: string;
  normalizedText?: string;
  statementKind?: string;
}): QuerySnapshot {
  const { language, text, normalizedText, statementKind } = params;
  const hashSource = text ?? normalizedText;
  return {
    language,
    text,
    normalizedText,
    sha256: hashSource === undefined ? undefined : sha256Hex(hashSource),
    statementKind,
  };
}

// Line budget for the rendered diff. The full texts are always kept in the
// snapshots above; only the precomputed diff is capped (§8.1).
const MAX_DIFF_INPUT_LINES = 2000;
const MAX_DIFF_OUTPUT_LINES = 600;

export function buildQueryComparison(
  baseline: QuerySnapshot | undefined,
  current: QuerySnapshot | undefined
): QueryComparison {
  const baselineText = baseline?.text ?? baseline?.normalizedText;
  const currentText = current?.text ?? current?.normalizedText;
  const changed =
    baselineText === undefined || currentText === undefined
      ? baselineText !== currentText
      : normalizeForCompare(baselineText) !== normalizeForCompare(currentText);

  if (baselineText === undefined || currentText === undefined || !changed) {
    return { baseline, current, changed, diff: [], diffTruncated: false };
  }
  return { baseline, current, changed, ...diffLines(baselineText, currentText) };
}

// Trailing whitespace and CRLF are never a real query change; everything else
// (including indentation and case) is left alone, since a Baseline comparison
// is supposed to show exactly what the user rewrote.
function normalizeForCompare(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/**
 * Plain LCS line diff. Deliberately not a word/character diff: §12 asks for a
 * side-by-side or unified view of two statements, and a line-level result is
 * what both renderings need. Falls back to a whole-body replacement when
 * either side is too long to diff cheaply.
 */
export function diffLines(
  baselineText: string,
  currentText: string
): { diff: QueryDiffLine[]; diffTruncated: boolean } {
  const a = splitLines(baselineText);
  const b = splitLines(currentText);

  if (a.length > MAX_DIFF_INPUT_LINES || b.length > MAX_DIFF_INPUT_LINES) {
    return {
      diff: [
        ...a.slice(0, 1).map((text, i) => line("removed", text, i + 1, undefined)),
        ...b.slice(0, 1).map((text, i) => line("added", text, undefined, i + 1)),
      ],
      diffTruncated: true,
    };
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const diff: QueryDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      diff.push(line("context", a[i], i + 1, j + 1));
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      diff.push(line("removed", a[i], i + 1, undefined));
      i++;
    } else {
      diff.push(line("added", b[j], undefined, j + 1));
      j++;
    }
  }
  for (; i < a.length; i++) {
    diff.push(line("removed", a[i], i + 1, undefined));
  }
  for (; j < b.length; j++) {
    diff.push(line("added", b[j], undefined, j + 1));
  }

  if (diff.length > MAX_DIFF_OUTPUT_LINES) {
    return { diff: diff.slice(0, MAX_DIFF_OUTPUT_LINES), diffTruncated: true };
  }
  return { diff, diffTruncated: false };
}

function line(
  kind: QueryDiffLine["kind"],
  text: string,
  baselineLineNumber: number | undefined,
  currentLineNumber: number | undefined
): QueryDiffLine {
  return { kind, text, baselineLineNumber, currentLineNumber };
}

// ---------------------------------------------------------------------------
// Index definitions (§9.1)
// ---------------------------------------------------------------------------

const INDEX_COMPARED_FIELDS = [
  "kind",
  "unique",
  "columns",
  "includedColumns",
  "predicate",
  "projectionType",
  "nonKeyAttributes",
] as const;

/**
 * Matches by (scope, indexName) and reports what differs. Never says
 * "created"/"dropped": these are two snapshots taken at different times, so
 * the only defensible statement is that an index was observed on one side and
 * not the other (§9.1).
 */
export function compareIndexSnapshots(
  baseline: IndexSnapshot[],
  current: IndexSnapshot[]
): { changes: IndexChange[]; unchangedCount: number } {
  const key = (index: IndexSnapshot) =>
    `${index.scope.toLocaleLowerCase()}\u0000${index.indexName.toLocaleLowerCase()}`;
  const baselineByKey = new Map(baseline.map((index) => [key(index), index]));
  const currentByKey = new Map(current.map((index) => [key(index), index]));

  const changes: IndexChange[] = [];
  let unchangedCount = 0;

  for (const index of current) {
    const previous = baselineByKey.get(key(index));
    if (!previous) {
      changes.push({ kind: "observedOnlyInCurrent", current: index });
      continue;
    }
    const changedFields = INDEX_COMPARED_FIELDS.filter(
      (field) => !sameIndexField(previous[field], index[field])
    );
    if (changedFields.length === 0) {
      unchangedCount++;
    } else {
      changes.push({
        kind: "definitionChanged",
        baseline: previous,
        current: index,
        changedFields: [...changedFields],
      });
    }
  }
  for (const index of baseline) {
    if (!currentByKey.has(key(index))) {
      changes.push({ kind: "observedOnlyInBaseline", baseline: index });
    }
  }
  return { changes, unchangedCount };
}

function sameIndexField(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    // Column order is part of an index's identity, so this is deliberately
    // not a set comparison.
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  return a === b;
}

// ---------------------------------------------------------------------------
// Collection status (§7)
// ---------------------------------------------------------------------------

export function compareCollection(
  baseline: {
    collectedAt: string;
    status: "complete" | "partial";
    diagnostics: Array<{ code: string }>;
    unavailableSections: unknown[];
  },
  current: {
    collectedAt: string;
    status: "complete" | "partial";
    diagnostics: Array<{ code: string }>;
    unavailableSections: unknown[];
  }
): PerformanceTuningComparisonEvidence["common"]["collection"] {
  const baselineCodes = new Set(baseline.diagnostics.map((d) => d.code));
  const currentCodes = new Set(current.diagnostics.map((d) => d.code));
  return {
    status: compareValue(baseline.status, current.status),
    collectedAt: compareValue(baseline.collectedAt, current.collectedAt),
    diagnosticCount: compareValue(baseline.diagnostics.length, current.diagnostics.length),
    unavailableSectionCount: compareValue(
      baseline.unavailableSections.length,
      current.unavailableSections.length
    ),
    diagnosticCodesOnlyInBaseline: [...baselineCodes].filter((code) => !currentCodes.has(code)).sort(),
    diagnosticCodesOnlyInCurrent: [...currentCodes].filter((code) => !baselineCodes.has(code)).sort(),
  };
}

/**
 * `partial` on either side means part of the evidence simply was not
 * collected, which is a caveat on every metric drawn from it (§11.2).
 */
export function collectionPartialReason(
  baselineStatus: "complete" | "partial",
  currentStatus: "complete" | "partial"
): ComparisonReason | undefined {
  if (baselineStatus === "complete" && currentStatus === "complete") {
    return undefined;
  }
  const sides = [
    baselineStatus === "partial" ? "baseline" : undefined,
    currentStatus === "partial" ? "current" : undefined,
  ].filter((side): side is string => side !== undefined);
  return {
    code: "COLLECTION_PARTIAL",
    level: "partiallyComparable",
    message: `Collection was incomplete on the ${sides.join(" and ")} side, so some evidence may be missing rather than absent.`,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher (§4, §16 Phase 1)
// ---------------------------------------------------------------------------

export type ComparisonBuildParams = {
  baseline: PerformanceTuningBaselineSelection;
  current: AnyTuningContext;
  // Injected so the builder stays pure and tests get stable output.
  now?: Date;
};

export type ComparisonBuildResult =
  | { ok: true; evidence: PerformanceTuningComparisonEvidence }
  | { ok: false; message: string };

/**
 * Builds the Comparison Evidence for two Contexts of the same engine. A
 * cross-engine pair is refused outright rather than returned as a
 * `notComparable` evidence: §5.2 puts RDB-vs-DynamoDB comparison out of
 * scope entirely, so there is no common axis to render at all, and the
 * Preview should keep its previous Baseline instead (§17.5).
 */
export function buildPerformanceTuningComparisonEvidence(
  params: ComparisonBuildParams
): ComparisonBuildResult {
  const { baseline, current, now = new Date() } = params;
  const baselineIsDynamo = isDynamoDbPerformanceTuningContext(baseline.context);
  const currentIsDynamo = isDynamoDbPerformanceTuningContext(current);

  if (baselineIsDynamo !== currentIsDynamo) {
    return {
      ok: false,
      message: `The selected baseline is a ${baselineIsDynamo ? "DynamoDB" : "relational database"} report, but the current preview is a ${currentIsDynamo ? "DynamoDB" : "relational database"} one. Comparing across engines is not supported.`,
    };
  }

  const generatedAt = now.toISOString();
  const source: PerformanceTuningComparisonEvidence["source"] = {
    baseline: baseline.source,
    current: {
      collectedAt: currentIsDynamo
        ? (current as DynamoDbPerformanceTuningContext).collection.collectedAt
        : (current as PerformanceTuningContext).collection.collectedAt,
    },
  };

  if (currentIsDynamo) {
    return {
      ok: true,
      evidence: buildDynamoDbComparison({
        baseline: baseline.context as DynamoDbPerformanceTuningContext,
        current: current as DynamoDbPerformanceTuningContext,
        source,
        generatedAt,
      }),
    };
  }
  return {
    ok: true,
    evidence: buildRdbComparison({
      baseline: baseline.context as PerformanceTuningContext,
      current: current as PerformanceTuningContext,
      source,
      generatedAt,
    }),
  };
}

/** Shared input every engine builder receives from the dispatcher above. */
export type EngineComparisonParams<T> = {
  baseline: T;
  current: T;
  source: PerformanceTuningComparisonEvidence["source"];
  generatedAt: string;
};
