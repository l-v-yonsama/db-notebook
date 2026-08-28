// Deterministic before/after comparison for Performance Tuning
// (misc/specs/performance-tuning-baseline-comparison-implementation-plan.ja.md
// §7). Everything in this file is computed by the extension host from two
// already-collected Contexts - never by an AI, and never by re-querying a
// database or AWS. The AI is downstream of this type, not upstream of it: it
// receives a projection of a Comparison Evidence (§13) and is instructed not
// to recompute the numbers here (§13.3).
//
// Lives in src/shared/ because the Preview webview renders it directly (§12).
// db-drivers Context types are imported type-only, matching
// PerformanceTuningActualEvidence.ts's precedent - the comparison result
// itself deliberately never travels back into db-drivers (§7).

import type {
  DynamoDbAccessPath,
  DynamoDbPerformanceTuningContext,
  PerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";

export type ComparisonEngine = "rdb" | "dynamodb";

/** Which Context type a Baseline/Current side actually holds (§6.2). */
export type AnyTuningContext = PerformanceTuningContext | DynamoDbPerformanceTuningContext;

// ---------------------------------------------------------------------------
// Comparability (§11)
// ---------------------------------------------------------------------------

export type ComparabilityLevel = "comparable" | "partiallyComparable" | "notComparable";

/**
 * Stable machine code plus beginner-facing text. The code is what tests and
 * the AI projection key off; `message` is what the Preview and the saved
 * report show, so it must read as a sentence on its own without the code.
 */
export type ComparisonReason = {
  code: ComparisonReasonCode;
  // The strongest level this single reason justifies. The evidence's overall
  // level is the strongest across all reasons, so one `notComparable` reason
  // is enough to make the whole comparison not comparable (§11).
  level: ComparabilityLevel;
  message: string;
  detail?: string;
};

export type ComparisonReasonCode =
  // notComparable (§11.1)
  | "ENGINE_MISMATCH"
  | "VENDOR_MISMATCH"
  | "DATABASE_MISMATCH"
  | "TABLE_MISMATCH"
  | "STATEMENT_KIND_MISMATCH"
  | "REGION_MISMATCH"
  | "CONTEXT_INVALID"
  // partiallyComparable (§11.2)
  | "QUERY_CHANGED"
  | "RESULT_SHAPE_CHANGED"
  | "PLAN_MODE_MIXED"
  | "WORKLOAD_VS_SINGLE_OBSERVATION"
  | "CLOUDWATCH_WINDOW_MISMATCH"
  | "COLLECTION_PARTIAL"
  | "STATISTICS_FRESHNESS_GAP"
  | "OBSERVATION_BOUNDED_ONE_SIDE"
  | "OBSERVATION_BOUNDS_DIFFER"
  | "TARGET_SET_CHANGED"
  | "ENVIRONMENT_MISMATCH"
  | "BENCHMARK_SAMPLE_COUNT_DIFFERS"
  | "BENCHMARK_COMPLETENESS_DIFFERS"
  | "BENCHMARK_PROTOCOL_DIFFERS"
  // comparable, but worth stating (§11.3)
  | "ENVIRONMENT_MAY_DIFFER"
  | "CLOUDWATCH_SCOPE_WIDER_THAN_STATEMENT"
  | "DYNAMODB_METADATA_APPROXIMATE"
  | "OPTIMIZER_STATISTICS_POINT_IN_TIME";

/** Per-metric verdict, so one unusable metric never sinks the whole table (§11). */
export type MetricComparability = {
  metricKey: string;
  comparability: "comparable" | "notComparable";
  reason?: string;
};

// ---------------------------------------------------------------------------
// Values and numbers (§7, §10)
// ---------------------------------------------------------------------------

export type ComparisonValue<T> = {
  baseline?: T;
  current?: T;
  changed: boolean;
};

export type MetricDirection = "lowerIsBetter" | "higherIsBetter" | "neutral";

/**
 * How the Preview labels a metric row. Deliberately separate from
 * `comparability`: a metric can be comparable and unchanged, or comparable
 * with only one side present (`noData`), and neither is an improvement or a
 * regression. Never derived from the sign of `percentChange` alone - the
 * metric's `direction` decides which sign is good, and a `neutral` metric
 * that moved is only ever "changed", never "improved"/"regressed" (§7).
 */
export type MetricAssessment =
  | "improved"
  | "regressed"
  | "unchanged"
  | "changed"
  | "noData"
  | "notComparable";

export type MetricMissingDataGuidance = {
  // Short action-oriented label shown in the Assessment column.
  action: string;
  // Explains why that action supplies the missing side and what it executes.
  detail: string;
};

export type NumericComparison = {
  // Stable identifier used by metricDecisions, the AI projection, and tests.
  key: string;
  label: string;
  baseline?: number;
  current?: number;
  unit: string;
  absoluteDelta?: number;
  // Signed pure rate of change, ((current - baseline) / |baseline|) * 100.
  percentChange?: number;
  // The same magnitude re-signed so positive always means "better", per
  // `direction`. Never populated for `neutral` metrics (§7).
  improvementPercent?: number;
  // Only for metrics that are themselves ratios/fractions, where subtracting
  // two rates is the honest figure and a "percent change of a percent" is
  // not (§10.1).
  percentagePointDelta?: number;
  direction: MetricDirection;
  comparability: "comparable" | "notComparable";
  reason?: string;
  // Present only for a one-sided missing value that the user can resolve with
  // a known action. Benchmark collection uses this; arbitrary missing metrics
  // retain the generic noData assessment.
  missingDataGuidance?: MetricMissingDataGuidance;
  assessment: MetricAssessment;
};

// ---------------------------------------------------------------------------
// Target identity (§7)
// ---------------------------------------------------------------------------

export type TargetIdentity = {
  engine: ComparisonEngine;
  // RDB only.
  vendor?: string;
  vendorVersion?: string;
  databaseName?: string;
  schemaName?: string;
  // DynamoDB only. `endpointKind` separates a real AWS table from a local or
  // custom endpoint (DynamoDB Local, LocalStack); without it two tables with
  // the same name in the two places look identical here.
  region?: string;
  endpointKind?: string;
  // Which deployment this was collected from, when the source records it.
  // Two different values mean timings are not a like-for-like measure (§11.2).
  environment?: string;
  // Both: the statement's primary target.
  tableName?: string;
  indexName?: string;
};

// ---------------------------------------------------------------------------
// Query evidence (§8)
// ---------------------------------------------------------------------------

export type QueryLanguage = "sql" | "partiql" | "dynamodb-query";

export type QuerySnapshot = {
  language: QueryLanguage;
  // Verbatim and unmasked, exactly as the Context already holds it (§15).
  text?: string;
  normalizedText?: string;
  // SHA-256 of `text` when present, else of `normalizedText`. Lets a reader
  // confirm two reports refer to the same statement without re-reading both
  // bodies.
  sha256?: string;
  statementKind?: string;
};

export type QueryDiffLineKind = "context" | "added" | "removed";

export type QueryDiffLine = {
  kind: QueryDiffLineKind;
  baselineLineNumber?: number;
  currentLineNumber?: number;
  text: string;
};

export type QueryComparison = {
  baseline?: QuerySnapshot;
  current?: QuerySnapshot;
  changed: boolean;
  // Line-level unified diff for display. Empty when either side has no text
  // at all (a native DynamoDB Query has structure but no statement body).
  diff: QueryDiffLine[];
  // True when the diff was cut off at the line budget; the full texts above
  // are still complete.
  diffTruncated: boolean;
};

// ---------------------------------------------------------------------------
// Index and schema evidence (§9)
// ---------------------------------------------------------------------------

/**
 * A vendor-neutral flattening of one index definition, built so two
 * definitions can be compared field by field without either engine's own
 * shape leaking into the comparison layer.
 */
export type IndexSnapshot = {
  // "schema.table" for RDB, the table name for DynamoDB - what the index
  // belongs to, used to scope name matching.
  scope: string;
  indexName: string;
  // RDB: the vendor's own indexType, or "primary"/"unique". DynamoDB: "LSI"/"GSI".
  kind?: string;
  unique?: boolean;
  // Ordered and formatted for display, e.g. "created_at desc".
  columns: string[];
  includedColumns?: string[];
  predicate?: string;
  // DynamoDB only.
  projectionType?: string;
  nonKeyAttributes?: string[];
};

/**
 * Deliberately worded as an observation, not an action: two Contexts are
 * snapshots at different times, so the extension can only report that an
 * index was seen on one side and not the other - never that someone created
 * or dropped it (§9.1).
 */
export type IndexChange =
  | { kind: "observedOnlyInCurrent"; current: IndexSnapshot }
  | { kind: "observedOnlyInBaseline"; baseline: IndexSnapshot }
  | {
      kind: "definitionChanged";
      baseline: IndexSnapshot;
      current: IndexSnapshot;
      // Field names from IndexSnapshot, e.g. ["columns", "unique"].
      changedFields: string[];
    };

export type IndexComparison = {
  changes: IndexChange[];
  unchangedCount: number;
  // Which indexes the statement itself actually used - kept separate from the
  // definition diff above, because adding an index and using an index are
  // different facts the Preview shows on separate rows (§12).
  used: ComparisonValue<string[]>;
};

// ---------------------------------------------------------------------------
// Access path evidence (§8.2, §8.3)
// ---------------------------------------------------------------------------

export type AccessPathStep = {
  // "schema.table" (RDB) or the table/index name (DynamoDB).
  target: string;
  // RDB: the normalized plan node's operation. DynamoDB: the accessPath.
  operation: string;
  indexName?: string;
};

export type AccessPathChange = {
  target: string;
  baseline?: AccessPathStep;
  current?: AccessPathStep;
  // How many plan nodes touched this target on each side. Anything other than
  // exactly one on both sides means there is no unambiguous correspondence to
  // compare, so `ambiguous` is set and `changed` stays false rather than the
  // builder picking a node and guessing (§10.2).
  baselineNodeCount: number;
  currentNodeCount: number;
  changed: boolean;
  ambiguous: boolean;
};

export type AccessPathComparison = {
  changes: AccessPathChange[];
  // True when at least one target's operation or index differs.
  changed: boolean;
};

// ---------------------------------------------------------------------------
// Workload and collection (§7)
// ---------------------------------------------------------------------------

export type WorkloadComparison = {
  available: { baseline: boolean; current: boolean };
  source: ComparisonValue<string>;
  metrics: NumericComparison[];
};

export type CollectionComparison = {
  status: ComparisonValue<"complete" | "partial">;
  collectedAt: ComparisonValue<string>;
  diagnosticCount: ComparisonValue<number>;
  unavailableSectionCount: ComparisonValue<number>;
  // Diagnostic codes present on one side only, so a reader can see that a
  // warning went away (or appeared) without diffing two whole Contexts.
  diagnosticCodesOnlyInBaseline: string[];
  diagnosticCodesOnlyInCurrent: string[];
};

// ---------------------------------------------------------------------------
// Engine-specific evidence (§7)
// ---------------------------------------------------------------------------

export type RdbComparisonEvidence = {
  vendor: ComparisonValue<string>;
  statementKind: ComparisonValue<string>;
  planMode: ComparisonValue<"estimate" | "analyze">;
  // "actual" only when both sides have real runtime evidence
  // (hasActualExecutionEvidence()); execution-only metrics are marked not
  // comparable otherwise (§11.1).
  evidenceKind: ComparisonValue<"estimate" | "actual">;
  accessPath: AccessPathComparison;
  dominantCostNode: ComparisonValue<string>;
  metrics: NumericComparison[];
};

export type DynamoDbComparisonEvidence = {
  language: ComparisonValue<string>;
  operation: ComparisonValue<string>;
  accessPath: ComparisonValue<DynamoDbAccessPath>;
  // The table or secondary index the read actually goes through - this is
  // what moves when a Scan is replaced by a GSI Query.
  accessTarget: ComparisonValue<string>;
  partitionKeyCondition: ComparisonValue<string>;
  sortKeyCondition: ComparisonValue<string>;
  postReadFilter: ComparisonValue<string[]>;
  projection: ComparisonValue<string>;
  consistentRead: ComparisonValue<string>;
  scanDirection: ComparisonValue<string>;
  /**
   * Three separately-meaningful caps that §10.3 forbids collapsing into one
   * another: the DynamoDB API's own per-request `Limit`, the Query Panel's
   * cross-response result cap, and Run Observed Read's `maxEvaluatedItems`
   * (which surfaces as `observationBound`, not as a statement property).
   */
  limits: {
    apiLimit: ComparisonValue<number>;
    resultItemLimit: ComparisonValue<number>;
    observationBound: ComparisonValue<string>;
  };
  // 'complete' | 'bounded' | 'unknown' per side; a one-sided bound is a
  // partial-comparability reason, never silently averaged away (§11.2).
  observationCompleteness: ComparisonValue<string>;
  benchmarkCompleteness: ComparisonValue<string>;
  cloudWatch?: {
    // "<duration> min @ <period>s" per side. The absolute start/end always
    // differ (the two collections happened at different times, which is the
    // entire point) - only the shape of the window can meaningfully match.
    window: ComparisonValue<string>;
    // True when duration or period differ, which makes per-window aggregates
    // incomparable and marks every CloudWatch row not comparable (§11.2).
    windowMismatch: boolean;
  };
  metrics: NumericComparison[];
};

// ---------------------------------------------------------------------------
// The evidence itself (§7)
// ---------------------------------------------------------------------------

export type BaselineSourceInfo = {
  fileName: string;
  // Absolute path of the file at selection time. Local-environment
  // information, so the Preview and HTML report keep it under "Advanced
  // details" rather than the header (§14).
  sourcePath?: string;
  // SHA-256 of the extracted Baseline Context JSON, not of the whole .dbn -
  // the Context is what the comparison actually consumed (§6.3).
  contextSha256: string;
  collectedAt?: string;
  selectedAt: string;
};

export type PerformanceTuningComparisonEvidence = {
  formatVersion: 1;
  engine: ComparisonEngine;
  generatedAt: string;

  source: {
    baseline: BaselineSourceInfo;
    current: { collectedAt?: string };
  };

  comparability: {
    level: ComparabilityLevel;
    reasons: ComparisonReason[];
    metricDecisions: MetricComparability[];
  };

  common: {
    target: ComparisonValue<TargetIdentity>;
    query: QueryComparison;
    workload: WorkloadComparison;
    indexes: IndexComparison;
    collection: CollectionComparison;
  };

  engineSpecific:
    | { kind: "rdb"; value: RdbComparisonEvidence }
    | { kind: "dynamodb"; value: DynamoDbComparisonEvidence };
};

/**
 * How aggressively the AI Comparison Input was compacted to fit a model's
 * input limit (§13.1). Lives here rather than beside the projector because
 * PerformanceTuningAiAnalysis.ts records it in a saved analysis's request
 * metadata, and that file is shared with the webview.
 *
 * - `full`: every difference the comparison found, including the query diff.
 * - `noDiffHunks`: the diff hunks are dropped; both query bodies are kept.
 * - `minimal`: collection differences and comparable-level notes also go.
 */
export type ComparisonAiInputDetail = "full" | "noDiffHunks" | "minimal";

/**
 * What the Preview keeps for a selected Baseline: the source metadata, the
 * extracted Context snapshot itself, and nothing that requires the original
 * file to still exist. Re-reading the .dbn after selection is deliberately
 * never done - a comparison shown on screen must stay reproducible even if
 * the file moves or changes underneath it (§6.3).
 */
export type PerformanceTuningBaselineSelection = {
  source: BaselineSourceInfo;
  context: AnyTuningContext;
};
