// Projects a Comparison Evidence down to what an AI actually needs
// (misc/specs/performance-tuning-baseline-comparison-implementation-plan.ja.md
// §13). The Baseline's whole Full Context is never sent: §2 item 2 rules out
// handing the model two complete contexts, and §13.1 lists exactly what the
// projection keeps instead - both query bodies, the structural differences,
// the already-computed numbers, and the per-metric comparability verdicts.
//
// Pure functions, no VS Code API. The shrink levels below are the only place
// that decides what to drop, and every drop is recorded in `omittedFields` so
// the model (and a later reader of the saved report) can see what is missing
// rather than silently reasoning over a truncated picture (§13.1's closing
// rule).

import type {
  ComparisonAiInputDetail,
  ComparisonValue,
  NumericComparison,
  PerformanceTuningComparisonEvidence,
} from "../shared/PerformanceTuningComparison";

/**
 * The shrink ladder, in the order §13.1 prescribes. The panel walks it,
 * measuring against the model's own maxInputTokens between each step; `full`
 * is what a saved report and the "Copy Prompt for Other AI" path use.
 */
export const COMPARISON_AI_INPUT_DETAILS: ComparisonAiInputDetail[] = [
  "full",
  "noDiffHunks",
  "minimal",
];

export type ComparisonAiInput = {
  formatVersion: 1;
  detail: ComparisonAiInputDetail;
  // Dot paths of everything this projection left out, relative to the
  // Comparison Evidence. Never empty at a non-"full" detail.
  omittedFields: string[];
  omissionReason?: string;

  engine: "rdb" | "dynamodb";
  baseline: { fileName: string; collectedAt?: string };
  current: { collectedAt?: string };

  comparability: {
    level: PerformanceTuningComparisonEvidence["comparability"]["level"];
    reasons: Array<{ code: string; level: string; message: string }>;
    // Only the metrics the extension refused to compare, with why. The
    // comparable ones carry their own verdict inside `metrics` below, so
    // repeating all of them here would just be the same list twice.
    rejectedMetrics: Array<{ metricKey: string; reason?: string }>;
    // At minimal detail, repeated reason prose is grouped once with all
    // affected keys. This preserves every rejection decision without paying
    // the token cost of repeating the same sentence per metric.
    rejectedMetricGroups?: Array<{ metricKeys: string[]; reason?: string }>;
  };

  query: {
    changed: boolean;
    baselineText?: string;
    currentText?: string;
    // Present only at "full" detail - the bodies above always stay (§13.1
    // step 2 drops the hunks, never the statements).
    diffHunks?: string[];
    diffTruncated?: boolean;
  };

  structure: Record<string, { baseline: unknown; current: unknown }>;

  accessPath: Array<{
    target: string;
    baseline?: string;
    current?: string;
    changed: boolean;
    ambiguous?: boolean;
  }>;

  indexes: {
    changes: Array<{ observation: string; index: string }>;
    unchangedCount: number;
    usedByBaseline?: string[];
    usedByCurrent?: string[];
  };

  metrics: Array<{
    key: string;
    label?: string;
    unit: string;
    direction?: NumericComparison["direction"];
    baseline?: number;
    current?: number;
    absoluteDelta?: number;
    percentChange?: number;
    improvementPercent?: number;
    percentagePointDelta?: number;
    assessment: NumericComparison["assessment"];
  }>;

  // Collection differences worth mentioning; dropped entirely at "minimal".
  collection?: {
    statusBaseline: string;
    statusCurrent: string;
    diagnosticCodesOnlyInBaseline: string[];
    diagnosticCodesOnlyInCurrent: string[];
  };
};

export function buildComparisonAiInput(
  evidence: PerformanceTuningComparisonEvidence,
  detail: ComparisonAiInputDetail = "full"
): ComparisonAiInput {
  const omittedFields: string[] = [];
  const { common, engineSpecific } = evidence;

  if (detail !== "full") {
    omittedFields.push("common.query.diff");
  }
  if (detail === "minimal") {
    omittedFields.push("common.collection", "comparability.reasons[level=comparable]");
  }
  // The projection never carries these regardless of detail - they are the
  // parts of a Baseline that §13.1 explicitly rules out sending.
  omittedFields.push(
    "baseline.tables[].definition",
    "baseline.tables[].statistics",
    "baseline.executionPlan.vendorPlan",
    "baseline.cloudWatch.series[].timestamps",
    "baseline.cloudWatch.series[].values"
  );

  const reasons =
    detail === "minimal"
      ? evidence.comparability.reasons.filter((reason) => reason.level !== "comparable")
      : evidence.comparability.reasons;
  const rejectedDecisions = evidence.comparability.metricDecisions.filter(
    (decision) => decision.comparability === "notComparable",
  );
  const rejectedMetricGroups = new Map<string | undefined, string[]>();
  for (const decision of rejectedDecisions) {
    const keys = rejectedMetricGroups.get(decision.reason) ?? [];
    keys.push(decision.metricKey);
    rejectedMetricGroups.set(decision.reason, keys);
  }

  return {
    formatVersion: 1,
    detail,
    omittedFields,
    omissionReason:
      detail === "full"
        ? "Only the baseline's full table definitions, statistics, raw vendor plan, and CloudWatch datapoints were left out; every difference the comparison found is included."
        : "The comparison input was reduced to fit the selected language model's input limit.",

    engine: evidence.engine,
    baseline: {
      fileName: evidence.source.baseline.fileName,
      collectedAt: evidence.source.baseline.collectedAt,
    },
    current: { collectedAt: evidence.source.current.collectedAt },

    comparability: {
      level: evidence.comparability.level,
      reasons: reasons.map((reason) => ({
        code: reason.code,
        level: reason.level,
        message: reason.message,
      })),
      rejectedMetrics:
        detail === "minimal"
          ? []
          : rejectedDecisions.map(({ metricKey, reason }) => ({ metricKey, reason })),
      ...(detail === "minimal"
        ? {
            rejectedMetricGroups: [...rejectedMetricGroups].map(([reason, metricKeys]) => ({
              metricKeys,
              reason,
            })),
          }
        : {}),
    },

    query: {
      changed: common.query.changed,
      // Both statement bodies always travel, at every detail level - §13.1
      // step 2 drops the diff hunks and keeps the queries.
      baselineText: common.query.baseline?.text,
      currentText: common.query.current?.text,
      ...(detail === "full"
        ? {
            diffHunks: common.query.diff.map(
              (line) =>
                `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} ${line.text}`
            ),
            diffTruncated: common.query.diffTruncated,
          }
        : {}),
    },

    structure: structureOf(evidence),

    accessPath:
      engineSpecific.kind === "rdb"
        ? engineSpecific.value.accessPath.changes.map((change) => ({
            target: change.target,
            baseline: describeStep(change.baseline),
            current: describeStep(change.current),
            changed: change.changed,
            ...(change.ambiguous ? { ambiguous: true } : {}),
          }))
        : [
            {
              target: engineSpecific.value.accessTarget.current ?? "",
              baseline: engineSpecific.value.accessPath.baseline,
              current: engineSpecific.value.accessPath.current,
              changed: engineSpecific.value.accessPath.changed,
            },
          ],

    indexes: {
      changes: common.indexes.changes.map((change) => {
        switch (change.kind) {
          case "observedOnlyInCurrent":
            return {
              observation: "not in baseline, observed in current",
              index: describeIndex(change.current),
            };
          case "observedOnlyInBaseline":
            return {
              observation: "in baseline, not observed in current",
              index: describeIndex(change.baseline),
            };
          case "definitionChanged":
            return {
              observation: `definition differs (${change.changedFields.join(", ")})`,
              index: `${describeIndex(change.baseline)} -> ${describeIndex(change.current)}`,
            };
        }
      }),
      unchangedCount: common.indexes.unchangedCount,
      usedByBaseline: common.indexes.used.baseline,
      usedByCurrent: common.indexes.used.current,
    },

    metrics: [...common.workload.metrics, ...engineSpecific.value.metrics]
      // A metric the extension refused to compare is listed once under
      // `rejectedMetrics` with its reason; repeating its raw numbers here
      // invites the model to compute the improvement the extension
      // deliberately declined to (§13.3).
      .filter((metric) => metric.comparability === "comparable")
      .map((metric) => ({
        key: metric.key,
        ...(detail === "minimal" ? {} : { label: metric.label }),
        unit: metric.unit,
        ...(detail === "minimal" ? {} : { direction: metric.direction }),
        baseline: metric.baseline,
        current: metric.current,
        absoluteDelta: metric.absoluteDelta,
        percentChange: metric.percentChange,
        improvementPercent: metric.improvementPercent,
        percentagePointDelta: metric.percentagePointDelta,
        assessment: metric.assessment,
      })),

    ...(detail === "minimal"
      ? {}
      : {
          collection: {
            statusBaseline: common.collection.status.baseline ?? "unknown",
            statusCurrent: common.collection.status.current ?? "unknown",
            diagnosticCodesOnlyInBaseline: common.collection.diagnosticCodesOnlyInBaseline,
            diagnosticCodesOnlyInCurrent: common.collection.diagnosticCodesOnlyInCurrent,
          },
        }),
  };
}

function structureOf(
  evidence: PerformanceTuningComparisonEvidence
): ComparisonAiInput["structure"] {
  const pairs: Array<[string, ComparisonValue<unknown>]> =
    evidence.engineSpecific.kind === "rdb"
      ? [
          ["vendor", evidence.engineSpecific.value.vendor],
          ["statementKind", evidence.engineSpecific.value.statementKind],
          ["planMode", evidence.engineSpecific.value.planMode],
          ["evidenceKind", evidence.engineSpecific.value.evidenceKind],
          ["dominantCostNode", evidence.engineSpecific.value.dominantCostNode],
        ]
      : [
          ["requestLanguage", evidence.engineSpecific.value.language],
          ["operation", evidence.engineSpecific.value.operation],
          ["readTarget", evidence.engineSpecific.value.accessTarget],
          ["partitionKeyCondition", evidence.engineSpecific.value.partitionKeyCondition],
          ["sortKeyCondition", evidence.engineSpecific.value.sortKeyCondition],
          ["postReadFilter", evidence.engineSpecific.value.postReadFilter],
          ["projection", evidence.engineSpecific.value.projection],
          ["consistentRead", evidence.engineSpecific.value.consistentRead],
          ["scanDirection", evidence.engineSpecific.value.scanDirection],
          // The three separately-meaningful caps §10.3 forbids conflating,
          // named so the model cannot read one as another.
          ["dynamoDbApiLimit", evidence.engineSpecific.value.limits.apiLimit],
          ["queryPanelResultItemCap", evidence.engineSpecific.value.limits.resultItemLimit],
          ["observedReadBound", evidence.engineSpecific.value.limits.observationBound],
          ["observationCompleteness", evidence.engineSpecific.value.observationCompleteness],
          ...(evidence.engineSpecific.value.cloudWatch
            ? ([["cloudWatchWindow", evidence.engineSpecific.value.cloudWatch.window]] as Array<
                [string, ComparisonValue<unknown>]
              >)
            : []),
        ];

  const structure: ComparisonAiInput["structure"] = {};
  for (const [key, value] of pairs) {
    // Unchanged properties with no value on either side say nothing; keeping
    // them would only pad the payload.
    if (value.baseline === undefined && value.current === undefined) {
      continue;
    }
    structure[key] = { baseline: value.baseline, current: value.current };
  }
  return structure;
}

function describeStep(step: { operation: string; indexName?: string } | undefined): string | undefined {
  if (!step) {
    return undefined;
  }
  return step.indexName ? `${step.operation} using ${step.indexName}` : step.operation;
}

function describeIndex(index: {
  scope: string;
  indexName: string;
  kind?: string;
  unique?: boolean;
  columns: string[];
  includedColumns?: string[];
  predicate?: string;
  projectionType?: string;
  nonKeyAttributes?: string[];
}): string {
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
 * The instructions that accompany a comparison input (§13.3). Kept beside the
 * projection rather than inside each engine's prompt file so both engines,
 * both the Copilot path and the "Copy Prompt for Other AI" path, ask the
 * model for exactly the same discipline.
 */
export function buildComparisonInstructions(engine: "rdb" | "dynamodb"): string {
  const shared = [
    "# Before/after comparison",
    "",
    "The user also supplied a comparison against an earlier saved report (the baseline). Every difference, rate of change, and improvement percentage in it was already computed deterministically by the extension from the two collected contexts.",
    "",
    "- Do not recalculate any of those figures, and never state a number that contradicts one in `comparisonInput.metrics`.",
    "- `comparisonInput.comparability.rejectedMetrics` lists metrics the extension refused to compare, with the reason. At minimal detail the equivalent decisions are grouped under `rejectedMetricGroups`. Do not derive an improvement from either representation, and do not present those metrics as evidence of a gain.",
    "- When `comparisonInput.comparability.level` is `notComparable`, do not claim a performance improvement at all; explain what would have to match for a comparison to mean something.",
    "- The two contexts are snapshots from different times. Describe a query, access-path, or index difference as correlated with a metric change, not as its proven cause.",
    "- An index listed under `comparisonInput.indexes.changes` was observed on one side and not the other. Do not assert that someone created or dropped it.",
    "- The baseline report may contain its own AI analysis text. It was deliberately not given to you; do not assume anything about what it said.",
    "- If the current statement has no remaining problem, say so. Do not manufacture a recommendation just because a comparison was requested.",
  ];
  const perEngine =
    engine === "rdb"
      ? [
          "- Optimizer estimates and real execution timings are different kinds of evidence. When `structure.evidenceKind` differs between the two sides, say so before comparing anything measured at runtime.",
          "- Plan node ids are not stable across two collections. Refer to a plan step by its operation, table, and index, never by an id carried over from the baseline.",
        ]
      : [
          "- A CloudWatch series marked as having no datapoints is not a measured zero, and never an improvement to zero.",
          "- CloudWatch aggregates all traffic against the table or index in its window, including other statements. Never present it as this one request's measurement.",
          "- `dynamoDbApiLimit`, `queryPanelResultItemCap`, and `observedReadBound` are three different caps. Do not treat a change in one as a change in another.",
          "- A bounded observation did not evaluate the statement's full result. Do not compare its item counts or consumed capacity against a complete one.",
        ];
  return [...shared, ...perEngine].join("\n");
}
