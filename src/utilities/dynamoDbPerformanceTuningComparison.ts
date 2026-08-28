// DynamoDB-specific half of the Performance Tuning before/after comparison
// (misc/specs/performance-tuning-baseline-comparison-implementation-plan.ja.md
// §8.3, §9.3, §10.3, §11). Pure functions only - see the header of
// performanceTuningComparison.ts, which owns every primitive used here and is
// the only module that calls buildDynamoDbComparison().
//
// Two rules from §10.3 shape most of this file:
//   - a CloudWatch series with `noData: true` is not "0 activity", so it never
//     becomes a 0 and never produces an improvement figure; and
//   - a bounded observation (Run Observed Read's cap, or a history sample that
//     still had a continuation token) did not see the statement's full result,
//     so pairing it against a complete one would manufacture an improvement.

import type {
  DynamoDbAccessPattern,
  DynamoDbCapacityBreakdown,
  DynamoDbCloudWatchContext,
  DynamoDbCloudWatchSeries,
  DynamoDbIndexContext,
  DynamoDbPerformanceTuningContext,
  DynamoDbReadObservation,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  ComparisonReason,
  DynamoDbComparisonEvidence,
  IndexSnapshot,
  MetricMissingDataGuidance,
  NumericComparison,
  PerformanceTuningComparisonEvidence,
  TargetIdentity,
  WorkloadComparison,
} from "../shared/PerformanceTuningComparison";
import {
  applyBlockingComparability,
  buildQueryComparison,
  buildQuerySnapshot,
  collectionPartialReason,
  compareCollection,
  compareIndexSnapshots,
  compareNumericMetric,
  compareStringListValue,
  compareValue,
  resolveComparabilityLevel,
  toMetricDecisions,
  withoutEmptyMetrics,
  type EngineComparisonParams,
  type NumericMetricInput,
} from "./performanceTuningComparison";

// Tolerance for calling two CloudWatch lookback windows the same shape. The
// collection code derives the window from `lookbackMinutes` at collection
// time, so equal-length windows can still land a second or two apart.
const WINDOW_DURATION_TOLERANCE_MS = 60_000;

export function buildDynamoDbComparison(
  params: EngineComparisonParams<DynamoDbPerformanceTuningContext>
): PerformanceTuningComparisonEvidence {
  const { baseline, current, source, generatedAt } = params;

  const cloudWatch = buildCloudWatchWindowComparison(baseline.cloudWatch, current.cloudWatch);
  const observationMismatch = observationCompletenessMismatch(baseline, current);
  // A local/custom endpoint (DynamoDB Local, LocalStack) and real AWS have
  // nothing in common for latency, so client timings across them are not a
  // like-for-like measure (§11.2).
  const environmentMismatch = environmentMismatchReason(baseline, current);
  const reasons = buildReasons({
    baseline,
    current,
    cloudWatch,
    observationMismatch,
    environmentMismatch,
  });

  const collectedWorkload = buildWorkloadComparison(baseline, current, environmentMismatch);
  const workload: WorkloadComparison = {
    ...collectedWorkload,
    metrics: applyBlockingComparability(collectedWorkload.metrics, reasons),
  };
  const engineMetrics = applyBlockingComparability(
    [
      ...buildObservationMetrics(
        baseline.observation,
        current.observation,
        observationMismatch,
        environmentMismatch
      ),
      ...buildBenchmarkMetrics(baseline, current, environmentMismatch),
      ...buildCloudWatchMetrics(
        baseline.cloudWatch,
        current.cloudWatch,
        cloudWatch?.windowMismatch,
        environmentMismatch
      ),
    ],
    reasons
  );
  const metrics = [...workload.metrics, ...engineMetrics];

  const engineSpecific: DynamoDbComparisonEvidence = {
    language: compareValue(baseline.statement.language, current.statement.language),
    operation: compareValue(baseline.accessPattern.operation, current.accessPattern.operation),
    accessPath: compareValue(baseline.accessPattern.accessPath, current.accessPattern.accessPath),
    accessTarget: compareValue(accessTarget(baseline), accessTarget(current)),
    partitionKeyCondition: compareValue(
      keyCondition(baseline.accessPattern.partitionKey),
      keyCondition(current.accessPattern.partitionKey)
    ),
    sortKeyCondition: compareValue(
      keyCondition(baseline.accessPattern.sortKey),
      keyCondition(current.accessPattern.sortKey)
    ),
    postReadFilter: compareStringListValue(
      [...baseline.accessPattern.postReadFilter.attributes].sort(),
      [...current.accessPattern.postReadFilter.attributes].sort()
    ),
    projection: compareValue(
      describeProjection(baseline.accessPattern),
      describeProjection(current.accessPattern)
    ),
    consistentRead: compareValue(
      baseline.accessPattern.consistentRead,
      current.accessPattern.consistentRead
    ),
    scanDirection: compareValue(
      scanDirection(baseline.accessPattern),
      scanDirection(current.accessPattern)
    ),
    limits: {
      apiLimit: compareValue(baseline.accessPattern.limit, current.accessPattern.limit),
      resultItemLimit: compareValue(
        baseline.accessPattern.resultItemLimit,
        current.accessPattern.resultItemLimit
      ),
      observationBound: compareValue(
        baseline.observation?.boundDescription,
        current.observation?.boundDescription
      ),
    },
    observationCompleteness: compareValue(
      observationCompleteness(baseline.observation),
      observationCompleteness(current.observation)
    ),
    benchmarkCompleteness: compareValue(
      benchmarkCompleteness(baseline.benchmark),
      benchmarkCompleteness(current.benchmark)
    ),
    cloudWatch,
    metrics: engineMetrics,
  };

  return {
    formatVersion: 1,
    engine: "dynamodb",
    generatedAt,
    source,
    comparability: {
      level: resolveComparabilityLevel(reasons),
      reasons,
      metricDecisions: toMetricDecisions(metrics),
    },
    common: {
      target: compareValue(
        targetIdentity(baseline),
        targetIdentity(current),
        (a, b) => JSON.stringify(a) === JSON.stringify(b)
      ),
      query: buildQueryComparison(querySnapshot(baseline), querySnapshot(current)),
      workload,
      indexes: {
        ...compareIndexSnapshots(indexSnapshots(baseline), indexSnapshots(current)),
        used: compareStringListValue(usedIndexes(baseline), usedIndexes(current)),
      },
      collection: compareCollection(baseline.collection, current.collection),
    },
    engineSpecific: { kind: "dynamodb", value: engineSpecific },
  };
}

function buildBenchmarkMetrics(
  baseline: DynamoDbPerformanceTuningContext,
  current: DynamoDbPerformanceTuningContext,
  environmentMismatch: string | undefined
): NumericComparison[] {
  const b = baseline.benchmark;
  const c = current.benchmark;
  const protocolMismatch = benchmarkProtocolMismatch(b, c);
  const completenessMismatch = benchmarkCompletenessMismatch(b, c);
  const notComparable = protocolMismatch ?? completenessMismatch ?? environmentMismatch;
  const missingDataGuidance = benchmarkMissingDataGuidance(baseline, current);
  const inputs: NumericMetricInput[] = [
    {
      key: "dynamodb.benchmark.medianClientElapsedTimeMs",
      label: "Benchmark median client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.medianClientElapsedTimeMs,
      current: c?.medianClientElapsedTimeMs,
      notComparable,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.averageClientElapsedTimeMs",
      label: "Benchmark average client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.averageClientElapsedTimeMs,
      current: c?.averageClientElapsedTimeMs,
      notComparable,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.minClientElapsedTimeMs",
      label: "Benchmark minimum client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.minClientElapsedTimeMs,
      current: c?.minClientElapsedTimeMs,
      notComparable,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.maxClientElapsedTimeMs",
      label: "Benchmark maximum client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.maxClientElapsedTimeMs,
      current: c?.maxClientElapsedTimeMs,
      notComparable,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.medianConsumedReadCapacityUnits",
      label: "Benchmark median consumed read capacity",
      unit: "RCU",
      direction: "lowerIsBetter",
      baseline: b?.medianConsumedReadCapacityUnits,
      current: c?.medianConsumedReadCapacityUnits,
      notComparable,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.medianEvaluatedItemCount",
      label: "Benchmark median evaluated items",
      unit: "items",
      direction: "lowerIsBetter",
      baseline: b?.medianEvaluatedItemCount,
      current: c?.medianEvaluatedItemCount,
      notComparable,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.medianReturnedItemCount",
      label: "Benchmark median returned items",
      unit: "items",
      direction: "neutral",
      baseline: b?.medianReturnedItemCount,
      current: c?.medianReturnedItemCount,
      notComparable,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.readEfficiency",
      label: "Benchmark read efficiency (returned / evaluated)",
      unit: "fraction",
      direction: "higherIsBetter",
      isRatio: true,
      baseline: benchmarkReadEfficiency(b),
      current: benchmarkReadEfficiency(c),
      notComparable: protocolMismatch ?? environmentMismatch,
      missingDataGuidance,
    },
    {
      key: "dynamodb.benchmark.consumedCapacityPerReturnedItem",
      label: "Benchmark consumed capacity per returned item",
      unit: "RCU/item",
      direction: "lowerIsBetter",
      baseline: capacityPerReturnedItem(b),
      current: capacityPerReturnedItem(c),
      notComparable: protocolMismatch ?? environmentMismatch,
      missingDataGuidance,
    },
  ];
  return withoutEmptyMetrics(inputs.map(compareNumericMetric));
}

function benchmarkCompleteness(
  session: DynamoDbPerformanceTuningContext["benchmark"]
): "complete" | "bounded" | "unknown" | "mixed" | "not measured" {
  if (!session) {
    return "not measured";
  }
  if (session.completeness) {
    return session.completeness;
  }
  const values = [...new Set(session.samples.map((sample) => sample.completeness))];
  return values.length === 1 ? values[0] : "mixed";
}

function benchmarkCompletenessMismatch(
  baseline: DynamoDbPerformanceTuningContext["benchmark"],
  current: DynamoDbPerformanceTuningContext["benchmark"]
): string | undefined {
  if (!baseline || !current) {
    return undefined;
  }
  const b = benchmarkCompleteness(baseline);
  const c = benchmarkCompleteness(current);
  return b === c
    ? undefined
    : `The benchmark sessions measured different amounts of work (baseline: ${b}, current: ${c}). A bounded run measures only part of the result, so raw time, item counts, and Capacity cannot be compared with a complete run.`;
}

function benchmarkProtocolMismatch(
  baseline: DynamoDbPerformanceTuningContext["benchmark"],
  current: DynamoDbPerformanceTuningContext["benchmark"]
): string | undefined {
  if (!baseline || !current) {
    return undefined;
  }
  if (
    baseline.completedRuns !== baseline.requestedRuns ||
    current.completedRuns !== current.requestedRuns
  ) {
    return "At least one benchmark session did not complete every requested run.";
  }
  const baselineMode = baseline.mode ?? "page";
  const currentMode = current.mode ?? "page";
  const bothComplete =
    benchmarkCompleteness(baseline) === "complete" &&
    benchmarkCompleteness(current) === "complete";
  if (baselineMode !== currentMode && !bothComplete) {
    return `The benchmark modes differ (baseline: ${baselineMode}, current: ${currentMode}). Raw elapsed time, item counts, and Capacity do not represent the same measurement protocol.`;
  }
  if (
    benchmarkCompleteness(baseline) !== "complete" &&
    benchmarkCompleteness(current) !== "complete" &&
    baseline.boundDescription !== current.boundDescription
  ) {
    return "The benchmark sessions stopped at different bounds, so their raw elapsed time, item counts, and Capacity do not represent the same amount of work.";
  }
  return undefined;
}

function benchmarkReadEfficiency(
  session: DynamoDbPerformanceTuningContext["benchmark"]
): number | undefined {
  const returned = session?.medianReturnedItemCount;
  const evaluated = session?.medianEvaluatedItemCount;
  return returned !== undefined && evaluated !== undefined && evaluated > 0
    ? returned / evaluated
    : undefined;
}

function capacityPerReturnedItem(
  session: DynamoDbPerformanceTuningContext["benchmark"]
): number | undefined {
  const capacity = session?.medianConsumedReadCapacityUnits;
  const returned = session?.medianReturnedItemCount;
  return capacity !== undefined && returned !== undefined && returned > 0
    ? capacity / returned
    : undefined;
}

function benchmarkMissingDataGuidance(
  baseline: DynamoDbPerformanceTuningContext,
  current: DynamoDbPerformanceTuningContext,
): MetricMissingDataGuidance | undefined {
  if (baseline.benchmark && !current.benchmark) {
    const runs = baseline.benchmark.requestedRuns;
    const completeResult = baseline.benchmark.mode === "completeResult";
    return {
      action: `Run ${completeResult ? "Complete-result " : "Page "}Benchmark (${runs} runs) for Current`,
      detail:
        `Current has no benchmark. This action performs ${runs} ${completeResult ? "continuation-aware reads up to the complete-result safety limits" : "bounded one-page reads"} using the same conditions; the first run also refreshes the collected context.`,
    };
  }
  if (!baseline.benchmark && current.benchmark) {
    return {
      action: "Select a benchmarked baseline",
      detail:
        `The baseline has no benchmark. Select or recreate a baseline report containing Benchmark (${current.benchmark.requestedRuns} runs).`,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Comparability (§11)
// ---------------------------------------------------------------------------

function buildReasons(params: {
  baseline: DynamoDbPerformanceTuningContext;
  current: DynamoDbPerformanceTuningContext;
  cloudWatch: DynamoDbComparisonEvidence["cloudWatch"];
  observationMismatch: ObservationMismatch | undefined;
  environmentMismatch: string | undefined;
}): ComparisonReason[] {
  const { baseline, current, cloudWatch, observationMismatch, environmentMismatch } = params;
  const reasons: ComparisonReason[] = [];

  if (environmentMismatch) {
    reasons.push({
      code: "ENVIRONMENT_MISMATCH",
      level: "partiallyComparable",
      message: environmentMismatch,
    });
  }

  if (baseline.service.tableName !== current.service.tableName) {
    reasons.push({
      code: "TABLE_MISMATCH",
      level: "notComparable",
      message: `The baseline targets table "${baseline.service.tableName}" and the current preview targets "${current.service.tableName}".`,
    });
  }
  if (
    baseline.service.region &&
    current.service.region &&
    baseline.service.region !== current.service.region
  ) {
    reasons.push({
      code: "REGION_MISMATCH",
      level: "notComparable",
      message: `The two tables live in different regions (${baseline.service.region} vs ${current.service.region}), so they hold different data.`,
    });
  }

  if (baseline.statement.language !== current.statement.language) {
    reasons.push({
      code: "STATEMENT_KIND_MISMATCH",
      level: "partiallyComparable",
      message: `The baseline is a ${languageLabel(baseline.statement.language)} read and the current preview is a ${languageLabel(current.statement.language)} one. Access path and capacity still compare, but PartiQL responses carry no evaluated-item count at all.`,
    });
  }

  if (normalizedStatement(baseline) !== normalizedStatement(current)) {
    reasons.push({
      code: "QUERY_CHANGED",
      level: "partiallyComparable",
      message: "The request changed, so the two sides may not return the same items. Check the request diff before reading any improvement figure as a pure efficiency gain.",
    });
  }

  if (observationMismatch) {
    reasons.push({
      code: observationMismatch.code,
      level: "partiallyComparable",
      message: observationMismatch.message,
    });
  }

  const partial = collectionPartialReason(baseline.collection.status, current.collection.status);
  if (partial) {
    reasons.push(partial);
  }

  if (Boolean(baseline.workload) !== Boolean(current.workload)) {
    reasons.push({
      code: "WORKLOAD_VS_SINGLE_OBSERVATION",
      level: "partiallyComparable",
      message: `Rolling workload statistics are present only on the ${baseline.workload ? "baseline" : "current"} side, so the workload rows have nothing to compare against.`,
    });
  }

  if (
    baseline.benchmark &&
    current.benchmark &&
    baseline.benchmark.requestedRuns !== current.benchmark.requestedRuns
  ) {
    reasons.push({
      code: "BENCHMARK_SAMPLE_COUNT_DIFFERS",
      level: "partiallyComparable",
      message: `Benchmark sample counts differ (${baseline.benchmark.requestedRuns} runs vs ${current.benchmark.requestedRuns} runs). When the measurement modes and result coverage match, their medians remain comparable, but the smaller sample has lower confidence.`,
    });
  }

  const benchmarkProtocol = benchmarkProtocolMismatch(
    baseline.benchmark,
    current.benchmark
  );
  if (benchmarkProtocol) {
    reasons.push({
      code: "BENCHMARK_PROTOCOL_DIFFERS",
      level: "partiallyComparable",
      message: benchmarkProtocol,
    });
  }

  const benchmarkMismatch = benchmarkCompletenessMismatch(
    baseline.benchmark,
    current.benchmark
  );
  if (benchmarkMismatch) {
    reasons.push({
      code: "BENCHMARK_COMPLETENESS_DIFFERS",
      level: "partiallyComparable",
      message: benchmarkMismatch,
    });
  }

  if (cloudWatch?.windowMismatch) {
    reasons.push({
      code: "CLOUDWATCH_WINDOW_MISMATCH",
      level: "partiallyComparable",
      message: `The two CloudWatch lookback windows have different shapes (${cloudWatch.window.baseline} vs ${cloudWatch.window.current}), so their aggregates cover different amounts of time.`,
    });
  }
  if (baseline.cloudWatch || current.cloudWatch) {
    reasons.push({
      code: "CLOUDWATCH_SCOPE_WIDER_THAN_STATEMENT",
      level: "comparable",
      message: "CloudWatch aggregates every request against the table or index during the window, including traffic from other statements - it is not a measurement of this one request.",
    });
  }

  reasons.push({
    code: "DYNAMODB_METADATA_APPROXIMATE",
    level: "comparable",
    message: "DescribeTable's item count and table size are approximate and refreshed roughly every six hours, so small differences are not evidence of a change.",
  });
  reasons.push({
    code: "ENVIRONMENT_MAY_DIFFER",
    level: "comparable",
    message: "Even for an identical request, item volume, partition distribution, and concurrent load differ between two collection times.",
  });

  return reasons;
}

/**
 * A bounded read stopped early, so its returned/evaluated/capacity figures are
 * not the statement's full cost (§10.3, §11.2). Two cases are rejected:
 *
 *  - one side bounded and the other complete - the cap itself would show up as
 *    an improvement; and
 *  - both bounded but cut off at different points - a 10-item cap against a
 *    100-item cap produces a 10x "improvement" that is purely the two caps.
 *    `boundDescription` is the only record of where each stopped, so two
 *    bounded reads without it cannot be shown to match either.
 */
type ObservationMismatch = {
  code: "OBSERVATION_BOUNDED_ONE_SIDE" | "OBSERVATION_BOUNDS_DIFFER";
  message: string;
};

function observationCompletenessMismatch(
  baseline: DynamoDbPerformanceTuningContext,
  current: DynamoDbPerformanceTuningContext
): ObservationMismatch | undefined {
  const b = observationCompleteness(baseline.observation);
  const c = observationCompleteness(current.observation);
  if (b === undefined || c === undefined) {
    return undefined;
  }
  if (b !== c) {
    return {
      code: "OBSERVATION_BOUNDED_ONE_SIDE",
      message: `The two observations saw different amounts of the result (baseline: ${b}, current: ${c}), so their item counts and consumed capacity measure different work.`,
    };
  }
  if (b !== "bounded") {
    return undefined;
  }

  const baselineBound = baseline.observation?.boundDescription;
  const currentBound = current.observation?.boundDescription;
  if (baselineBound && currentBound && baselineBound === currentBound) {
    return undefined;
  }
  return {
    code: "OBSERVATION_BOUNDS_DIFFER",
    message:
      baselineBound || currentBound
        ? `Both observations stopped early, but at different points (baseline: ${baselineBound ?? "not recorded"}; current: ${currentBound ?? "not recorded"}), so their item counts and consumed capacity reflect the two cut-offs rather than the statements.`
        : "Both observations stopped early and neither recorded where, so their item counts and consumed capacity cannot be shown to cover the same amount of work.",
  };
}

/**
 * A local or custom endpoint (DynamoDB Local, LocalStack) is a different
 * machine and a different service implementation from real AWS, so client
 * timings across the two measure the environment, not the request (§11.2).
 * Item counts and consumed capacity stay comparable - those are properties of
 * the data and the access path.
 */
function environmentMismatchReason(
  baseline: DynamoDbPerformanceTuningContext,
  current: DynamoDbPerformanceTuningContext
): string | undefined {
  const b = baseline.service.endpointKind;
  const c = current.service.endpointKind;
  if (b === c) {
    return undefined;
  }
  const label = (kind: string) => (kind === "aws" ? "real AWS" : "a local or custom endpoint");
  return `The two sides were collected against different endpoints (baseline: ${label(b)}, current: ${label(c)}), so client timings reflect different environments.`;
}

function observationCompleteness(
  observation: DynamoDbReadObservation | undefined
): string | undefined {
  if (!observation) {
    return undefined;
  }
  // `completeness` is the expressive field; `bounded` is the older one every
  // observation still sets, so it is the fallback rather than the primary.
  return observation.completeness ?? (observation.bounded ? "bounded" : "complete");
}

// ---------------------------------------------------------------------------
// Identity, request, indexes (§8.3, §9.3)
// ---------------------------------------------------------------------------

function targetIdentity(context: DynamoDbPerformanceTuningContext): TargetIdentity {
  return {
    engine: "dynamodb",
    region: context.service.region,
    endpointKind: context.service.endpointKind,
    tableName: context.service.tableName,
    indexName: context.accessPattern.indexName ?? context.service.indexName,
  };
}

function querySnapshot(context: DynamoDbPerformanceTuningContext) {
  return buildQuerySnapshot({
    language: context.statement.language === "partiql" ? "partiql" : "dynamodb-query",
    // A native Query has no statement body at all; its structure is compared
    // through the accessPattern fields instead (§8.3).
    text: context.statement.text ?? describeNativeQuery(context.accessPattern),
    statementKind: context.statement.kind,
  });
}

/**
 * A stable, human-readable rendering of a native Query's structure, so the
 * request diff has something to show for the language that has no statement
 * text. Attribute names and operators only - never
 * ExpressionAttributeValues, which the Context deliberately does not hold
 * (§8.3, §15).
 */
function describeNativeQuery(pattern: DynamoDbAccessPattern): string {
  const lines = [
    `${pattern.operation} ${pattern.tableName}${pattern.indexName ? `.${pattern.indexName}` : ""}`,
    `key: ${keyCondition(pattern.partitionKey) ?? "(none)"}`,
    `sort: ${keyCondition(pattern.sortKey) ?? "(none)"}`,
    `filter: ${pattern.postReadFilter.present ? pattern.postReadFilter.attributes.join(", ") || "(present)" : "(none)"}`,
    `projection: ${describeProjection(pattern)}`,
    `consistentRead: ${pattern.consistentRead}`,
    `scanDirection: ${scanDirection(pattern)}`,
  ];
  return lines.join("\n");
}

function keyCondition(
  key: { attributeName: string; operator?: string; conditionPresent: boolean } | undefined
): string | undefined {
  if (!key) {
    return undefined;
  }
  if (!key.conditionPresent) {
    return `${key.attributeName} (no condition)`;
  }
  return `${key.attributeName} ${key.operator ?? "?"}`;
}

function describeProjection(pattern: DynamoDbAccessPattern): string {
  const { mode, attributes } = pattern.projection;
  if (mode === "specific") {
    return `specific: ${[...attributes].sort().join(", ")}`;
  }
  return mode;
}

function scanDirection(pattern: DynamoDbAccessPattern): string | undefined {
  if (pattern.scanForward === undefined) {
    return undefined;
  }
  return pattern.scanForward ? "forward" : "reverse";
}

function accessTarget(context: DynamoDbPerformanceTuningContext): string {
  const { tableName, indexName } = context.accessPattern;
  return indexName ? `${tableName}.${indexName}` : tableName;
}

function languageLabel(language: string): string {
  return language === "partiql" ? "PartiQL" : "native Query/Scan";
}

function normalizedStatement(context: DynamoDbPerformanceTuningContext): string {
  const text = context.statement.text ?? describeNativeQuery(context.accessPattern);
  return text.replace(/\s+/g, " ").trim();
}

function indexSnapshots(context: DynamoDbPerformanceTuningContext): IndexSnapshot[] {
  const scope = context.table.tableName;
  const toSnapshot = (index: DynamoDbIndexContext): IndexSnapshot => ({
    scope,
    indexName: index.indexName,
    kind: index.indexType,
    columns: [
      index.keySchema.partitionKey.attributeName,
      ...(index.keySchema.sortKey ? [index.keySchema.sortKey.attributeName] : []),
    ],
    projectionType: index.projection.projectionType,
    nonKeyAttributes: index.projection.nonKeyAttributes
      ? [...index.projection.nonKeyAttributes].sort()
      : undefined,
  });
  return [
    ...context.table.localSecondaryIndexes.map(toSnapshot),
    ...context.table.globalSecondaryIndexes.map(toSnapshot),
  ];
}

function usedIndexes(context: DynamoDbPerformanceTuningContext): string[] {
  const indexName = context.accessPattern.indexName;
  return indexName ? [`${context.accessPattern.tableName}.${indexName}`] : [];
}

// ---------------------------------------------------------------------------
// Observation metrics (§10.3)
// ---------------------------------------------------------------------------

function buildObservationMetrics(
  baseline: DynamoDbReadObservation | undefined,
  current: DynamoDbReadObservation | undefined,
  observationMismatch: ObservationMismatch | undefined,
  environmentMismatch: string | undefined
): NumericComparison[] {
  const bounded = observationMismatch?.message;
  const inputs: NumericMetricInput[] = [
    {
      key: "dynamodb.observation.returnedItemCount",
      label: "Returned items",
      unit: "items",
      direction: "neutral",
      baseline: baseline?.returnedItemCount,
      current: current?.returnedItemCount,
      notComparable: bounded,
    },
    {
      key: "dynamodb.observation.evaluatedItemCount",
      label: "Evaluated items",
      unit: "items",
      direction: "lowerIsBetter",
      baseline: baseline?.evaluatedItemCount,
      current: current?.evaluatedItemCount,
      notComparable: bounded,
    },
    {
      key: "dynamodb.observation.filterPassRate",
      label: "Read efficiency (returned / evaluated)",
      unit: "fraction",
      direction: "higherIsBetter",
      isRatio: true,
      baseline: baseline?.filterPassRate,
      current: current?.filterPassRate,
      notComparable: bounded,
    },
    {
      key: "dynamodb.observation.consumedReadCapacity",
      label: "Consumed read capacity",
      unit: "RCU",
      direction: "lowerIsBetter",
      baseline: readCapacity(baseline?.consumedCapacity),
      current: readCapacity(current?.consumedCapacity),
      notComparable: bounded,
    },
    {
      key: "dynamodb.observation.tableConsumedReadCapacity",
      label: "Consumed read capacity (table)",
      unit: "RCU",
      direction: "lowerIsBetter",
      baseline: readCapacity(baseline?.consumedCapacity?.table),
      current: readCapacity(current?.consumedCapacity?.table),
      notComparable: bounded,
    },
    {
      key: "dynamodb.observation.clientElapsedTimeMs",
      label: "Client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: baseline?.clientElapsedTimeMs,
      current: current?.clientElapsedTimeMs,
      notComparable: bounded ?? environmentMismatch,
    },
    {
      key: "dynamodb.observation.requestCount",
      label: "Request count",
      unit: "requests",
      direction: "lowerIsBetter",
      baseline: baseline?.requestCount,
      current: current?.requestCount,
      notComparable: bounded,
    },
    {
      key: "dynamodb.observation.retryCount",
      label: "Retry count",
      unit: "retries",
      direction: "lowerIsBetter",
      baseline: baseline?.retryCount,
      current: current?.retryCount,
      notComparable: bounded,
    },
    // Per-index capacity is kept on its own key per index rather than folded
    // into the totals above: a Scan that becomes a GSI Query moves capacity
    // from the table to the index, and summing them would hide exactly that
    // (§10.3's "table / GSI capacity 内訳").
    ...indexCapacityInputs(baseline, current, bounded),
  ];
  return withoutEmptyMetrics(inputs.map(compareNumericMetric));
}

function indexCapacityInputs(
  baseline: DynamoDbReadObservation | undefined,
  current: DynamoDbReadObservation | undefined,
  bounded: string | undefined
): NumericMetricInput[] {
  const collect = (observation: DynamoDbReadObservation | undefined) => ({
    ...(observation?.consumedCapacity?.localSecondaryIndexes ?? {}),
    ...(observation?.consumedCapacity?.globalSecondaryIndexes ?? {}),
  });
  const baselineIndexes = collect(baseline);
  const currentIndexes = collect(current);
  const names = [...new Set([...Object.keys(baselineIndexes), ...Object.keys(currentIndexes)])].sort();
  return names.map((name) => ({
    key: `dynamodb.observation.indexConsumedReadCapacity.${name}`,
    label: `Consumed read capacity (${name})`,
    unit: "RCU",
    direction: "lowerIsBetter" as const,
    baseline: readCapacity(baselineIndexes[name]),
    current: readCapacity(currentIndexes[name]),
    notComparable: bounded,
  }));
}

function readCapacity(
  amount: { capacityUnits?: number; readCapacityUnits?: number } | DynamoDbCapacityBreakdown | undefined
): number | undefined {
  // ReturnConsumedCapacity reports reads under readCapacityUnits when it
  // splits them out and under capacityUnits when it does not.
  return amount?.readCapacityUnits ?? amount?.capacityUnits;
}

// ---------------------------------------------------------------------------
// CloudWatch (§10.3, §11.2)
// ---------------------------------------------------------------------------

function buildCloudWatchWindowComparison(
  baseline: DynamoDbCloudWatchContext | undefined,
  current: DynamoDbCloudWatchContext | undefined
): DynamoDbComparisonEvidence["cloudWatch"] {
  if (!baseline && !current) {
    return undefined;
  }
  const describe = (context: DynamoDbCloudWatchContext | undefined) =>
    context ? `${Math.round(windowDurationMs(context) / 60_000)} min @ ${context.window.periodSeconds}s` : undefined;
  const windowMismatch =
    !baseline ||
    !current ||
    baseline.window.periodSeconds !== current.window.periodSeconds ||
    Math.abs(windowDurationMs(baseline) - windowDurationMs(current)) > WINDOW_DURATION_TOLERANCE_MS;
  return {
    window: compareValue(describe(baseline), describe(current)),
    windowMismatch,
  };
}

function windowDurationMs(context: DynamoDbCloudWatchContext): number {
  return Date.parse(context.window.endTime) - Date.parse(context.window.startTime);
}

function buildCloudWatchMetrics(
  baseline: DynamoDbCloudWatchContext | undefined,
  current: DynamoDbCloudWatchContext | undefined,
  windowMismatch: boolean | undefined,
  environmentMismatch: string | undefined
): NumericComparison[] {
  if (!baseline && !current) {
    return [];
  }
  const baselineSeries = seriesByKey(baseline);
  const currentSeries = seriesByKey(current);
  const keys = [...new Set([...baselineSeries.keys(), ...currentSeries.keys()])].sort();

  return withoutEmptyMetrics(
    keys.map((key) => {
      const b = baselineSeries.get(key);
      const c = currentSeries.get(key);
      const template = b ?? c!;
      return compareNumericMetric({
        key: `dynamodb.cloudWatch.${key}`,
        label: seriesLabel(template),
        unit: template.unit ?? template.statistic,
        direction: cloudWatchDirection(template.metricName),
        baseline: seriesValue(b),
        current: seriesValue(c),
        notComparable:
          cloudWatchRejection(b, c, windowMismatch) ??
          // Latency series measure the service endpoint itself.
          (/Latency/i.test(template.metricName) ? environmentMismatch : undefined),
      });
    })
  );
}

function cloudWatchRejection(
  baseline: DynamoDbCloudWatchSeries | undefined,
  current: DynamoDbCloudWatchSeries | undefined,
  windowMismatch: boolean | undefined
): string | undefined {
  if (windowMismatch) {
    return "The two CloudWatch lookback windows cover different amounts of time.";
  }
  // A zero-datapoint response means CloudWatch had nothing to report, which
  // is a different fact from "the value was 0" (§10.3) - so it never becomes
  // a number and never produces an improvement figure.
  const noDataSides = [
    baseline?.noData ? "baseline" : undefined,
    current?.noData ? "current" : undefined,
  ].filter((side): side is string => side !== undefined);
  if (noDataSides.length > 0) {
    return `CloudWatch returned no datapoints on the ${noDataSides.join(" and ")} side, which is not the same as a measured 0.`;
  }
  if (baseline && current && baseline.statistic !== current.statistic) {
    return `The two sides were aggregated differently (${baseline.statistic} vs ${current.statistic}).`;
  }
  return undefined;
}

function seriesByKey(
  context: DynamoDbCloudWatchContext | undefined
): Map<string, DynamoDbCloudWatchSeries> {
  const byKey = new Map<string, DynamoDbCloudWatchSeries>();
  for (const series of context?.series ?? []) {
    // Scope/index/operation are part of the identity: a table-wide series and
    // a GSI series for the same metric name are different measurements and
    // must never be paired (§10.3).
    const key = [
      series.metricName,
      series.scope,
      series.indexName ?? "-",
      series.operation ?? "-",
    ].join(".");
    if (!byKey.has(key)) {
      byKey.set(key, series);
    }
  }
  return byKey;
}

function seriesLabel(series: DynamoDbCloudWatchSeries): string {
  const scope =
    series.scope === "gsi" && series.indexName
      ? `GSI ${series.indexName}`
      : series.scope === "operation" && series.operation
        ? `${series.operation} operation`
        : "table";
  return `CloudWatch ${series.metricName} (${series.statistic}, ${scope})`;
}

/**
 * The mean of the window's datapoints. Chosen over a sum because two windows
 * of the same shape can still return a different number of datapoints, and a
 * sum would then compare different amounts of time. `noData` series are
 * rejected before this runs, so an empty array here means the series carried
 * a header with no values and is treated as absent, never as 0.
 */
function seriesValue(series: DynamoDbCloudWatchSeries | undefined): number | undefined {
  if (!series || series.noData || series.values.length === 0) {
    return undefined;
  }
  return series.values.reduce((sum, value) => sum + value, 0) / series.values.length;
}

function cloudWatchDirection(metricName: string): NumericMetricInput["direction"] {
  if (/Throttl|Error/i.test(metricName)) {
    return "lowerIsBetter";
  }
  if (/Latency|Capacity|Scanned/i.test(metricName)) {
    return "lowerIsBetter";
  }
  return "neutral";
}

// ---------------------------------------------------------------------------
// Workload (§10.3)
// ---------------------------------------------------------------------------

function buildWorkloadComparison(
  baseline: DynamoDbPerformanceTuningContext,
  current: DynamoDbPerformanceTuningContext,
  environmentMismatch?: string
): WorkloadComparison {
  const b = baseline.workload;
  const c = current.workload;
  const sourceMismatch =
    b?.source && c?.source && b.source !== c.source
      ? `Workload statistics come from different sources (${b.source} vs ${c.source}).`
      : undefined;
  // A rolling aggregate that includes bounded samples did not see the full
  // result on every execution, so its item counts are floors, not totals.
  const boundedAggregate =
    (b?.boundedObservationCount ?? 0) > 0 || (c?.boundedObservationCount ?? 0) > 0
      ? "Some history samples stopped at a continuation token, so the aggregate item counts are lower bounds."
      : undefined;

  const inputs: NumericMetricInput[] = [
    {
      key: "dynamodb.workload.executionCount",
      label: "Workload execution count",
      unit: "executions",
      direction: "neutral",
      baseline: b?.executionCount,
      current: c?.executionCount,
      notComparable: sourceMismatch,
    },
    {
      key: "dynamodb.workload.averageClientElapsedTimeMs",
      label: "Workload average client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.averageClientElapsedTimeMs,
      current: c?.averageClientElapsedTimeMs,
      notComparable: sourceMismatch ?? environmentMismatch,
    },
    {
      key: "dynamodb.workload.maxClientElapsedTimeMs",
      label: "Workload max client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.maxClientElapsedTimeMs,
      current: c?.maxClientElapsedTimeMs,
      notComparable: sourceMismatch ?? environmentMismatch,
    },
    {
      key: "dynamodb.workload.averageCapacityUnits",
      label: "Workload average consumed capacity",
      unit: "CU",
      direction: "lowerIsBetter",
      baseline: b?.averageCapacityUnits,
      current: c?.averageCapacityUnits,
      notComparable: sourceMismatch,
    },
    {
      key: "dynamodb.workload.maxCapacityUnits",
      label: "Workload max consumed capacity",
      unit: "CU",
      direction: "lowerIsBetter",
      baseline: b?.maxCapacityUnits,
      current: c?.maxCapacityUnits,
      notComparable: sourceMismatch,
    },
    {
      key: "dynamodb.workload.weightedFilterPassRate",
      label: "Workload read efficiency (returned / evaluated)",
      unit: "fraction",
      direction: "higherIsBetter",
      isRatio: true,
      baseline: b?.weightedFilterPassRate,
      current: c?.weightedFilterPassRate,
      notComparable: sourceMismatch ?? boundedAggregate,
    },
    {
      key: "dynamodb.workload.totalEvaluatedItemCount",
      label: "Workload total evaluated items",
      unit: "items",
      direction: "lowerIsBetter",
      baseline: b?.totalEvaluatedItemCount,
      current: c?.totalEvaluatedItemCount,
      // Totals scale with execution count, so they only mean something when
      // both sides ran a comparable number of times.
      notComparable:
        sourceMismatch ??
        boundedAggregate ??
        (b?.executionCount !== c?.executionCount
          ? "The two sides aggregate a different number of executions, so totals are not comparable."
          : undefined),
    },
  ];

  return {
    available: { baseline: Boolean(b), current: Boolean(c) },
    source: compareValue(b?.source, c?.source),
    metrics: withoutEmptyMetrics(inputs.map(compareNumericMetric)),
  };
}
