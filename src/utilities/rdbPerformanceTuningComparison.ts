// Pure RDB-specific half of the before/after comparison.

import type {
  MetricValue,
  PerformanceTuningContext,
  PlanNode,
  PlanTableMapping,
  TableTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { hasActualExecutionEvidence } from "../shared/PerformanceTuningActualEvidence";
import type {
  AccessPathChange,
  AccessPathComparison,
  AccessPathStep,
  ComparisonReason,
  IndexSnapshot,
  MetricMissingDataGuidance,
  NumericComparison,
  PerformanceTuningComparisonEvidence,
  RdbComparisonEvidence,
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

// A statistics-age gap larger than this makes the optimizer's own inputs
// materially different between the two snapshots, which is a caveat on every
// estimate-derived metric (§11.2).
const STATISTICS_AGE_GAP_DAYS = 7;

export function buildRdbComparison(
  params: EngineComparisonParams<PerformanceTuningContext>
): PerformanceTuningComparisonEvidence {
  const { baseline, current, source, generatedAt } = params;

  const baselineActual = hasActualExecutionEvidence(baseline);
  const currentActual = hasActualExecutionEvidence(current);
  const bothActual = baselineActual && currentActual;

  const reasons = buildReasons({ baseline, current, baselineActual, currentActual });
  const query = buildQueryComparison(querySnapshot(baseline), querySnapshot(current));
  // Wall-clock timings and host I/O counters measure the machine as much as
  // the statement, so a different deployment makes them meaningless even when
  // everything else lines up (§11.2).
  const environmentMismatch = environmentMismatchReason(baseline, current);
  const collectedWorkload = buildWorkloadComparison(baseline, current, environmentMismatch);
  const workload: WorkloadComparison = {
    ...collectedWorkload,
    metrics: applyBlockingComparability(collectedWorkload.metrics, reasons),
  };
  const engineMetrics = applyBlockingComparability(
    buildPlanMetrics({ baseline, current, bothActual, environmentMismatch }),
    reasons
  );
  const metrics = [...workload.metrics, ...engineMetrics];

  const engineSpecific: RdbComparisonEvidence = {
    vendor: compareValue(baseline.database.vendor, current.database.vendor),
    statementKind: compareValue(baseline.statement.kind, current.statement.kind),
    planMode: compareValue(baseline.executionPlan.mode, current.executionPlan.mode),
    evidenceKind: compareValue(
      baselineActual ? "actual" : "estimate",
      currentActual ? "actual" : "estimate"
    ),
    accessPath: buildAccessPathComparison(baseline, current),
    dominantCostNode: compareValue(describeDominantNode(baseline), describeDominantNode(current)),
    metrics: engineMetrics,
  };

  return {
    formatVersion: 1,
    engine: "rdb",
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
      query,
      workload,
      indexes: {
        ...compareIndexSnapshots(indexSnapshots(baseline), indexSnapshots(current)),
        used: compareStringListValue(usedIndexes(baseline), usedIndexes(current)),
      },
      collection: compareCollection(baseline.collection, current.collection),
    },
    engineSpecific: { kind: "rdb", value: engineSpecific },
  };
}

// ---------------------------------------------------------------------------
// Comparability (§11)
// ---------------------------------------------------------------------------

function buildReasons(params: {
  baseline: PerformanceTuningContext;
  current: PerformanceTuningContext;
  baselineActual: boolean;
  currentActual: boolean;
}): ComparisonReason[] {
  const { baseline, current, baselineActual, currentActual } = params;
  const reasons: ComparisonReason[] = [];

  if (!sameIgnoringCase(baseline.database.vendor, current.database.vendor)) {
    reasons.push({
      code: "VENDOR_MISMATCH",
      level: "notComparable",
      message: `The baseline was collected from ${baseline.database.vendor} and the current preview from ${current.database.vendor}. Timings and costs from different database engines are not a like-for-like measure of improvement.`,
    });
  }
  if (!sameIgnoringCase(baseline.database.databaseName, current.database.databaseName)) {
    reasons.push({
      code: "DATABASE_MISMATCH",
      level: "notComparable",
      message: `The baseline targets database "${baseline.database.databaseName}" and the current preview targets "${current.database.databaseName}".`,
    });
  }

  const baselineTargets = targetTableKeys(baseline);
  const currentTargets = targetTableKeys(current);
  const shared = baselineTargets.filter((table) => currentTargets.includes(table));
  if (baselineTargets.length > 0 && currentTargets.length > 0) {
    if (shared.length === 0) {
      reasons.push({
        code: "TABLE_MISMATCH",
        level: "notComparable",
        message: `The two statements read completely different tables (baseline: ${baselineTargets.join(
          ", "
        )}; current: ${currentTargets.join(", ")}).`,
      });
    } else if (
      baselineTargets.length !== currentTargets.length ||
      shared.length !== baselineTargets.length
    ) {
      reasons.push({
        code: "TARGET_SET_CHANGED",
        level: "partiallyComparable",
        message:
          "The set of tables the statement reads changed, so row counts and timings cover different work on each side.",
        detail: `baseline: ${baselineTargets.join(", ")} / current: ${currentTargets.join(", ")}`,
      });
    }
  }

  if (
    baseline.statement.kind &&
    current.statement.kind &&
    baseline.statement.kind !== current.statement.kind
  ) {
    reasons.push({
      code: "STATEMENT_KIND_MISMATCH",
      level: "notComparable",
      message: `The baseline is a ${baseline.statement.kind.toUpperCase()} statement and the current preview is a ${current.statement.kind.toUpperCase()} statement.`,
    });
  }

  if (normalizedStatement(baseline) !== normalizedStatement(current)) {
    reasons.push({
      code: "QUERY_CHANGED",
      level: "partiallyComparable",
      message:
        "The statement text changed, so the two sides may not return the same rows. Check the query diff before reading any improvement figure as a pure speed-up.",
    });
  }

  if (baselineActual !== currentActual) {
    reasons.push({
      code: "PLAN_MODE_MIXED",
      level: "partiallyComparable",
      message: `Only the ${
        baselineActual ? "baseline" : "current"
      } side has real execution evidence; the other side is an optimizer estimate. Execution-only metrics are reported as not comparable.`,
    });
  }

  const partial = collectionPartialReason(baseline.collection.status, current.collection.status);
  if (partial) {
    reasons.push(partial);
  }

  const freshness = statisticsFreshnessReason(baseline, current);
  if (freshness) {
    reasons.push(freshness);
  }

  const environment = environmentMismatchReason(baseline, current);
  if (environment) {
    reasons.push({
      code: "ENVIRONMENT_MISMATCH",
      level: "partiallyComparable",
      message: environment,
    });
  }

  if (Boolean(baseline.workload) !== Boolean(current.workload)) {
    reasons.push({
      code: "WORKLOAD_VS_SINGLE_OBSERVATION",
      level: "partiallyComparable",
      message: `Rolling workload statistics are present only on the ${
        baseline.workload ? "baseline" : "current"
      } side, so the workload rows have nothing to compare against.`,
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
      message: `Benchmark sample counts differ (${baseline.benchmark.requestedRuns} runs vs ${current.benchmark.requestedRuns} runs). The sessions use the same measurement method, so their medians remain comparable, but the smaller sample has lower confidence.`,
    });
  }

  reasons.push({
    code: "ENVIRONMENT_MAY_DIFFER",
    level: "comparable",
    message:
      "Even for an identical statement, data volume, cache state, and concurrent load differ between two collection times.",
  });
  reasons.push({
    code: "OPTIMIZER_STATISTICS_POINT_IN_TIME",
    level: "comparable",
    message:
      "Optimizer statistics are a point-in-time snapshot, so estimated rows and costs reflect whatever the planner knew at each collection.",
  });

  return reasons;
}

/**
 * `database.environment` is a free-form label ("production", "staging", ...).
 * Two contexts carrying different ones came from different deployments, so
 * every wall-clock timing and host I/O counter between them measures the
 * machine as much as the statement (§11.2). Returns the text used both as the
 * comparability reason and as those metrics' own rejection reason.
 */
function environmentMismatchReason(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext
): string | undefined {
  const b = baseline.database.environment;
  const c = current.database.environment;
  if (!b || !c || b === c) {
    return undefined;
  }
  return `The two sides were collected from different environments (${b} vs ${c}), so timings and I/O counts reflect different machines.`;
}

function statisticsFreshnessReason(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext
): ComparisonReason | undefined {
  const baselineAge = statisticsAgeDays(baseline);
  const currentAge = statisticsAgeDays(current);
  if (baselineAge === undefined || currentAge === undefined) {
    return undefined;
  }
  if (Math.abs(baselineAge - currentAge) <= STATISTICS_AGE_GAP_DAYS) {
    return undefined;
  }
  return {
    code: "STATISTICS_FRESHNESS_GAP",
    level: "partiallyComparable",
    message:
      "Optimizer statistics were far more stale on one side than the other, which alone can change estimated rows and plan shape.",
    detail: `baseline: ${baselineAge.toFixed(1)} days old / current: ${currentAge.toFixed(
      1
    )} days old at collection time`,
  };
}

/** Oldest table statistics age, in days, relative to that side's own collection time. */
function statisticsAgeDays(context: PerformanceTuningContext): number | undefined {
  const collectedAt = Date.parse(context.collection.collectedAt);
  if (Number.isNaN(collectedAt)) {
    return undefined;
  }
  const ages = context.tables
    .map((table) => table.statistics?.statisticsUpdatedAt?.value)
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter((updatedAt) => !Number.isNaN(updatedAt))
    .map((updatedAt) => (collectedAt - updatedAt) / 86_400_000);
  return ages.length === 0 ? undefined : Math.max(...ages);
}

// ---------------------------------------------------------------------------
// Identity, query, indexes (§8.2, §9.2)
// ---------------------------------------------------------------------------

function targetIdentity(context: PerformanceTuningContext): TargetIdentity {
  const primary = context.planTableMappings[0];
  return {
    engine: "rdb",
    vendor: context.database.vendor,
    vendorVersion: context.database.version,
    databaseName: context.database.databaseName,
    schemaName: primary?.schemaName ?? context.database.schemaName,
    environment: context.database.environment,
    tableName: primary?.tableName,
    indexName: primary?.indexName,
  };
}

function querySnapshot(context: PerformanceTuningContext) {
  return buildQuerySnapshot({
    language: "sql",
    text: context.statement.sql,
    statementKind: context.statement.kind,
  });
}

function normalizedStatement(context: PerformanceTuningContext): string {
  return context.statement.sql.replace(/\s+/g, " ").trim();
}

function tableRef(table: { schemaName?: string; tableName: string }): string {
  return table.schemaName ? `${table.schemaName}.${table.tableName}` : table.tableName;
}

function targetTableKeys(context: PerformanceTuningContext): string[] {
  return [
    ...new Set(context.planTableMappings.map((mapping) => tableRef(mapping).toLocaleLowerCase())),
  ].sort();
}

function indexSnapshots(context: PerformanceTuningContext): IndexSnapshot[] {
  return context.tables.flatMap((table) => tableIndexSnapshots(table));
}

function tableIndexSnapshots(table: TableTuningContext): IndexSnapshot[] {
  const scope = tableRef(table);
  return (table.definition?.indexes ?? []).map((index) => ({
    scope,
    indexName: index.indexName,
    kind: index.primary ? "primary" : index.indexType,
    unique: index.unique,
    columns: index.columns.map((column) => {
      const name = column.columnName ?? column.expression ?? "?";
      const prefix = column.prefixLength === undefined ? "" : `(${column.prefixLength})`;
      const direction = column.direction ? ` ${column.direction}` : "";
      return `${name}${prefix}${direction}`;
    }),
    includedColumns: index.includedColumns,
    predicate: index.predicate,
  }));
}

function usedIndexes(context: PerformanceTuningContext): string[] {
  const fromPlan = walkPlan(context.executionPlan.normalizedPlan)
    .filter((node) => node.indexName)
    .map(
      (node) =>
        `${
          node.relation
            ? `${tableRef({
                schemaName: node.relation.schemaName,
                tableName: node.relation.tableName ?? "?",
              })}.`
            : ""
        }${node.indexName}`
    );
  const fromMappings = context.planTableMappings
    .filter((mapping) => mapping.indexName)
    .map((mapping) => `${tableRef(mapping)}.${mapping.indexName}`);
  return [...new Set([...fromPlan, ...fromMappings])].sort();
}

// ---------------------------------------------------------------------------
// Access path (§8.2, §10.2)
// ---------------------------------------------------------------------------

function buildAccessPathComparison(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext
): AccessPathComparison {
  const baselineSteps = accessSteps(baseline);
  const currentSteps = accessSteps(current);
  const targets = [...new Set([...baselineSteps.keys(), ...currentSteps.keys()])].sort();

  const changes: AccessPathChange[] = targets.map((target) => {
    const baselineNodes = baselineSteps.get(target) ?? [];
    const currentNodes = currentSteps.get(target) ?? [];
    // More than one access node per target has no defensible 1:1 mapping -
    // plan node IDs are not stable across collections (§10.2).
    const ambiguous = baselineNodes.length > 1 || currentNodes.length > 1;
    const baselineStep = baselineNodes.length === 1 ? baselineNodes[0] : undefined;
    const currentStep = currentNodes.length === 1 ? currentNodes[0] : undefined;
    return {
      target,
      baseline: baselineStep,
      current: currentStep,
      baselineNodeCount: baselineNodes.length,
      currentNodeCount: currentNodes.length,
      changed: ambiguous
        ? false
        : baselineStep?.operation !== currentStep?.operation ||
          baselineStep?.indexName !== currentStep?.indexName,
      ambiguous,
    };
  });

  return { changes, changed: changes.some((change) => change.changed) };
}

function accessSteps(context: PerformanceTuningContext): Map<string, AccessPathStep[]> {
  const steps = new Map<string, AccessPathStep[]>();
  for (const node of walkPlan(context.executionPlan.normalizedPlan)) {
    if (!node.relation?.tableName) {
      continue;
    }
    const target = tableRef({
      schemaName: node.relation.schemaName,
      tableName: node.relation.tableName,
    }).toLocaleLowerCase();
    const list = steps.get(target) ?? [];
    list.push({ target, operation: node.operation, indexName: node.indexName });
    steps.set(target, list);
  }
  return steps;
}

function describeDominantNode(context: PerformanceTuningContext): string | undefined {
  const dominant = context.executionPlan.dominantCostPlanNode;
  if (!dominant) {
    return undefined;
  }
  const node = walkPlan(context.executionPlan.normalizedPlan).find(
    (candidate) => candidate.id === dominant.planNodeId
  );
  if (!node) {
    return undefined;
  }
  // Deliberately identified by its stable attributes, never by planNodeId -
  // node IDs do not survive a re-collection (§10.2).
  const relation = node.relation?.tableName
    ? ` on ${tableRef({
        schemaName: node.relation.schemaName,
        tableName: node.relation.tableName,
      })}`
    : "";
  const index = node.indexName ? ` using ${node.indexName}` : "";
  return `${node.operation}${relation}${index}`;
}

function walkPlan(node: PlanNode | undefined): PlanNode[] {
  if (!node) {
    return [];
  }
  return [node, ...node.children.flatMap((child) => walkPlan(child))];
}

// ---------------------------------------------------------------------------
// Metrics (§10.2)
// ---------------------------------------------------------------------------

const EXECUTION_ONLY_REASON =
  "Only available from a real execution; one side has an optimizer estimate only.";

function buildPlanMetrics(params: {
  baseline: PerformanceTuningContext;
  current: PerformanceTuningContext;
  bothActual: boolean;
  environmentMismatch?: string;
}): NumericComparison[] {
  const { baseline, current, bothActual, environmentMismatch } = params;
  const executionOnly = bothActual ? undefined : EXECUTION_ONLY_REASON;
  // Timings and host I/O counters are the environment-sensitive ones; row
  // counts, estimates, and selectivity are properties of the data and plan,
  // so they stay comparable across deployments.
  const timing = executionOnly ?? environmentMismatch;
  const baselineRoot = baseline.executionPlan.normalizedPlan;
  const currentRoot = current.executionPlan.normalizedPlan;
  const benchmarkGuidance = benchmarkMissingDataGuidance(baseline, current);

  const inputs: NumericMetricInput[] = [
    {
      key: "rdb.benchmark.medianClientElapsedTimeMs",
      label: "Benchmark median client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: baseline.benchmark?.medianClientElapsedTimeMs,
      current: current.benchmark?.medianClientElapsedTimeMs,
      notComparable: benchmarkMismatch(baseline, current) ?? environmentMismatch,
      missingDataGuidance: benchmarkGuidance,
    },
    {
      key: "rdb.benchmark.averageClientElapsedTimeMs",
      label: "Benchmark average client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: baseline.benchmark?.averageClientElapsedTimeMs,
      current: current.benchmark?.averageClientElapsedTimeMs,
      notComparable: benchmarkMismatch(baseline, current) ?? environmentMismatch,
      missingDataGuidance: benchmarkGuidance,
    },
    {
      key: "rdb.benchmark.minClientElapsedTimeMs",
      label: "Benchmark minimum client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: baseline.benchmark?.minClientElapsedTimeMs,
      current: current.benchmark?.minClientElapsedTimeMs,
      notComparable: benchmarkMismatch(baseline, current) ?? environmentMismatch,
      missingDataGuidance: benchmarkGuidance,
    },
    {
      key: "rdb.benchmark.maxClientElapsedTimeMs",
      label: "Benchmark maximum client elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: baseline.benchmark?.maxClientElapsedTimeMs,
      current: current.benchmark?.maxClientElapsedTimeMs,
      notComparable: benchmarkMismatch(baseline, current) ?? environmentMismatch,
      missingDataGuidance: benchmarkGuidance,
    },
    {
      key: "rdb.plan.planningTimeMs",
      label: "Planning time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: baseline.executionPlan.planningTimeMs,
      current: current.executionPlan.planningTimeMs,
      notComparable: environmentMismatch,
    },
    {
      key: "rdb.plan.executionTimeMs",
      label: "Execution time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: baseline.executionPlan.executionTimeMs,
      current: current.executionPlan.executionTimeMs,
      notComparable: timing,
    },
    {
      key: "rdb.plan.estimatedRows",
      label: "Estimated returned rows",
      unit: "rows",
      direction: "neutral",
      baseline: baselineRoot?.estimated?.rows,
      current: currentRoot?.estimated?.rows,
    },
    {
      key: "rdb.plan.estimatedTotalCost",
      label: "Estimated total cost",
      unit: "cost",
      direction: "lowerIsBetter",
      baseline: baselineRoot?.estimated?.totalCost,
      current: currentRoot?.estimated?.totalCost,
      // Vendor cost units are only meaningful against the same vendor's own
      // model; the vendor mismatch check above already blocks the rest.
      notComparable: sameIgnoringCase(baseline.database.vendor, current.database.vendor)
        ? undefined
        : "Cost units are vendor-specific and cannot be compared across engines.",
    },
    {
      key: "rdb.plan.actualRows",
      label: "Actual returned rows",
      unit: "rows",
      direction: "neutral",
      baseline: baselineRoot?.actual?.rows,
      current: currentRoot?.actual?.rows,
      notComparable: executionOnly,
    },
    {
      key: "rdb.plan.maxLoops",
      label: "Max plan node loops",
      unit: "loops",
      direction: "lowerIsBetter",
      baseline: maxLoops(baselineRoot),
      current: maxLoops(currentRoot),
      notComparable: executionOnly,
    },
    {
      key: "rdb.plan.buffersHit",
      label: "Buffers hit",
      unit: "blocks",
      direction: "neutral",
      baseline: baselineRoot?.buffers?.hit,
      current: currentRoot?.buffers?.hit,
      notComparable: timing,
    },
    {
      key: "rdb.plan.buffersRead",
      label: "Buffers read",
      unit: "blocks",
      direction: "lowerIsBetter",
      baseline: baselineRoot?.buffers?.read,
      current: currentRoot?.buffers?.read,
      notComparable: timing,
    },
    {
      key: "rdb.plan.buffersWritten",
      label: "Buffers written",
      unit: "blocks",
      direction: "lowerIsBetter",
      baseline: baselineRoot?.buffers?.written,
      current: currentRoot?.buffers?.written,
      notComparable: timing,
    },
    {
      key: "rdb.plan.tempRead",
      label: "Temporary blocks read",
      unit: "blocks",
      direction: "lowerIsBetter",
      baseline: baselineRoot?.temp?.read,
      current: currentRoot?.temp?.read,
      notComparable: timing,
    },
    {
      key: "rdb.plan.tempWritten",
      label: "Temporary blocks written",
      unit: "blocks",
      direction: "lowerIsBetter",
      baseline: baselineRoot?.temp?.written,
      current: currentRoot?.temp?.written,
      notComparable: timing,
    },
    {
      key: "rdb.plan.dominantNodeExclusive",
      label: "Dominant node exclusive cost/time",
      unit: dominantUnit(baseline, current),
      direction: "lowerIsBetter",
      baseline: baseline.executionPlan.dominantCostPlanNode?.exclusiveValue,
      current: current.executionPlan.dominantCostPlanNode?.exclusiveValue,
      notComparable:
        baseline.executionPlan.dominantCostPlanNode?.metric !==
        current.executionPlan.dominantCostPlanNode?.metric
          ? "One side's dominant node is measured in time and the other in estimated cost units."
          : // Only the 'actual' variant is a wall-clock figure; vendor cost
          // units are a model output, not a machine measurement.
          baseline.executionPlan.dominantCostPlanNode?.metric === "actual"
          ? environmentMismatch
          : undefined,
    },
  ];

  return [
    ...withoutEmptyMetrics(inputs.map(compareNumericMetric)),
    ...buildTableMetrics(baseline, current, bothActual),
  ];
}

function benchmarkMismatch(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext
): string | undefined {
  const b = baseline.benchmark;
  const c = current.benchmark;
  if (b && c && (b.completedRuns !== b.requestedRuns || c.completedRuns !== c.requestedRuns)) {
    return "At least one benchmark session did not complete every requested run.";
  }
  return undefined;
}

function benchmarkMissingDataGuidance(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext
): MetricMissingDataGuidance | undefined {
  if (baseline.benchmark && !current.benchmark) {
    const runs = baseline.benchmark.requestedRuns;
    return {
      action: `Run Benchmark (${runs} runs) for Current`,
      detail: `Current has no benchmark. This action automatically collects EXPLAIN ANALYZE first, then runs the ordinary query ${runs} times; the EXPLAIN ANALYZE duration is excluded from the samples.`,
    };
  }
  if (!baseline.benchmark && current.benchmark) {
    return {
      action: "Select a benchmarked baseline",
      detail: `The baseline has no benchmark. Select or recreate a baseline report containing Benchmark (${current.benchmark.requestedRuns} runs).`,
    };
  }
  return undefined;
}

function dominantUnit(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext
): string {
  const metric =
    baseline.executionPlan.dominantCostPlanNode?.metric ??
    current.executionPlan.dominantCostPlanNode?.metric;
  return metric === "actual" ? "ms" : "cost";
}

function maxLoops(node: PlanNode | undefined): number | undefined {
  const loops = walkPlan(node)
    .map((candidate) => candidate.actual?.loops)
    .filter((value): value is number => value !== undefined);
  return loops.length === 0 ? undefined : Math.max(...loops);
}

/**
 * Per-table metrics for tables present on both sides. Tables reached only on
 * one side are deliberately skipped here - TARGET_SET_CHANGED already reports
 * that fact once, and a half-empty row per metric would only repeat it.
 */
function buildTableMetrics(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext,
  bothActual: boolean
): NumericComparison[] {
  const baselineByTable = mappingsByTable(baseline);
  const currentByTable = mappingsByTable(current);
  const shared = [...baselineByTable.keys()].filter((table) => currentByTable.has(table)).sort();

  return shared.flatMap((table) => {
    const baselineMappings = baselineByTable.get(table)!;
    const currentMappings = currentByTable.get(table)!;
    const b = baselineMappings[0];
    const c = currentMappings[0];
    // Several plan nodes on one table (a self join, or the same table reached
    // twice) have no stable correspondence across two collections, so pairing
    // "the first one" from each side would silently compare unrelated nodes.
    // Same rule buildAccessPathComparison() applies (§10.2): report the
    // ambiguity instead of guessing through it.
    const ambiguous =
      baselineMappings.length > 1 || currentMappings.length > 1
        ? `${table} is reached by ${baselineMappings.length} plan step(s) in the baseline and ${currentMappings.length} now, so the steps cannot be matched one to one.`
        : undefined;
    const executionOnly = ambiguous ?? (bothActual ? undefined : EXECUTION_ONLY_REASON);
    const prefix = `rdb.table.${table}`;
    const inputs: NumericMetricInput[] = [
      {
        key: `${prefix}.estimatedRows`,
        label: `${table}: estimated rows`,
        unit: "rows",
        direction: "neutral",
        baseline: b.estimatedRows,
        current: c.estimatedRows,
        notComparable: ambiguous,
      },
      {
        key: `${prefix}.actualRows`,
        label: `${table}: actual rows`,
        unit: "rows",
        direction: "neutral",
        baseline: b.actualRows,
        current: c.actualRows,
        notComparable: executionOnly,
      },
      {
        key: `${prefix}.rowEstimateRatio`,
        label: `${table}: row estimate ratio`,
        unit: "ratio",
        direction: "neutral",
        baseline: b.rowEstimateRatio,
        current: c.rowEstimateRatio,
        notComparable: executionOnly,
      },
      metricValueInput({
        key: `${prefix}.tableAccessRows`,
        label: `${table}: rows reached by table access`,
        direction: "lowerIsBetter",
        unit: "rows",
        baseline: b.tableAccessRows,
        current: c.tableAccessRows,
        notComparable: ambiguous,
      }),
      metricValueInput({
        key: `${prefix}.tableAccessFraction`,
        label: `${table}: table access fraction`,
        direction: "lowerIsBetter",
        unit: "fraction",
        isRatio: true,
        baseline: b.tableAccessFraction,
        current: c.tableAccessFraction,
        notComparable: ambiguous,
      }),
      metricValueInput({
        key: `${prefix}.predicateFilterSelectivity`,
        label: `${table}: predicate filter selectivity`,
        direction: "higherIsBetter",
        unit: "fraction",
        isRatio: true,
        baseline: b.predicateFilterSelectivity,
        current: c.predicateFilterSelectivity,
        notComparable: ambiguous,
      }),
      {
        key: `${prefix}.rowsRemovedByFilter`,
        label: `${table}: rows removed by filter`,
        unit: "rows",
        direction: "lowerIsBetter",
        baseline: rowsRemovedByFilter(b),
        current: rowsRemovedByFilter(c),
        notComparable: executionOnly,
      },
    ];
    return withoutEmptyMetrics(inputs.map(compareNumericMetric));
  });
}

/**
 * All mappings per table, not just the first - buildTableMetrics() needs the
 * count to decide whether the two sides can be matched one to one at all
 * (§10.2).
 */
function mappingsByTable(context: PerformanceTuningContext): Map<string, PlanTableMapping[]> {
  const byTable = new Map<string, PlanTableMapping[]>();
  for (const mapping of context.planTableMappings) {
    const key = tableRef(mapping).toLocaleLowerCase();
    byTable.set(key, [...(byTable.get(key) ?? []), mapping]);
  }
  return byTable;
}

function rowsRemovedByFilter(mapping: PlanTableMapping): number | undefined {
  const input = mapping.predicateFilterInputRows?.value;
  const output = mapping.predicateFilterOutputRows?.value;
  return input === undefined || output === undefined ? undefined : input - output;
}

/**
 * Turns a pair of MetricValue<number>s into a metric input, rejecting the
 * comparison when the two sides do not agree on unit, source, or whether the
 * figure is an estimate - §10.1's "単位、scope、source、集計方法が異なる" rule.
 */
function metricValueInput(params: {
  key: string;
  label: string;
  unit: string;
  direction: NumericMetricInput["direction"];
  isRatio?: boolean;
  baseline?: MetricValue<number>;
  current?: MetricValue<number>;
  // A rejection the caller already decided (an ambiguous plan-node match, for
  // example). It wins over the provenance checks below, which are about the
  // two MetricValues agreeing with each other.
  notComparable?: string;
}): NumericMetricInput {
  const { key, label, unit, direction, isRatio, baseline, current } = params;
  let notComparable: string | undefined = params.notComparable;
  if (!notComparable && baseline && current) {
    if (baseline.estimated !== current.estimated) {
      notComparable = "One side is an estimate and the other a measured value.";
    } else if (baseline.source !== current.source) {
      notComparable = `The two sides were read from different sources (${baseline.source} vs ${current.source}).`;
    } else if ((baseline.unit ?? unit) !== (current.unit ?? unit)) {
      notComparable = `The two sides report different units (${baseline.unit} vs ${current.unit}).`;
    }
  }
  return {
    key,
    label,
    unit: baseline?.unit ?? current?.unit ?? unit,
    direction,
    isRatio,
    baseline: baseline?.value,
    current: current?.value,
    notComparable,
  };
}

// ---------------------------------------------------------------------------
// Workload (§10.2)
// ---------------------------------------------------------------------------

function buildWorkloadComparison(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext,
  environmentMismatch?: string
): WorkloadComparison {
  const b = baseline.workload;
  const c = current.workload;
  // Two different providers aggregate over different windows and populations,
  // so a rate computed across them would not mean anything (§10.1).
  const sourceMismatch =
    b?.source && c?.source && b.source !== c.source
      ? `Workload statistics come from different sources (${b.source} vs ${c.source}).`
      : undefined;

  const inputs: NumericMetricInput[] = [
    {
      key: "rdb.workload.executionCount",
      label: "Workload execution count",
      unit: "executions",
      direction: "neutral",
      baseline: b?.executionCount,
      current: c?.executionCount,
      notComparable: sourceMismatch,
    },
    {
      key: "rdb.workload.averageElapsedTimeMs",
      label: "Workload average elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.averageElapsedTimeMs,
      current: c?.averageElapsedTimeMs,
      notComparable: sourceMismatch ?? environmentMismatch,
    },
    {
      key: "rdb.workload.maxElapsedTimeMs",
      label: "Workload max elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.maxElapsedTimeMs,
      current: c?.maxElapsedTimeMs,
      notComparable: sourceMismatch ?? environmentMismatch,
    },
    {
      key: "rdb.workload.minElapsedTimeMs",
      label: "Workload min elapsed time",
      unit: "ms",
      direction: "lowerIsBetter",
      baseline: b?.minElapsedTimeMs,
      current: c?.minElapsedTimeMs,
      notComparable: sourceMismatch ?? environmentMismatch,
    },
    {
      key: "rdb.workload.rowsProcessed",
      label: "Workload rows processed",
      unit: "rows",
      direction: "neutral",
      baseline: b?.rowsProcessed,
      current: c?.rowsProcessed,
      notComparable: sourceMismatch,
    },
    {
      key: "rdb.workload.rowsExamined",
      label: "Workload rows examined",
      unit: "rows",
      direction: "lowerIsBetter",
      baseline: b?.rowsExamined,
      current: c?.rowsExamined,
      notComparable: sourceMismatch,
    },
    {
      key: "rdb.workload.logicalReads",
      label: "Workload logical reads",
      unit: "reads",
      direction: "lowerIsBetter",
      baseline: b?.logicalReads,
      current: c?.logicalReads,
      notComparable: sourceMismatch,
    },
    {
      key: "rdb.workload.physicalReads",
      label: "Workload physical reads",
      unit: "reads",
      direction: "lowerIsBetter",
      baseline: b?.physicalReads,
      current: c?.physicalReads,
      notComparable: sourceMismatch ?? environmentMismatch,
    },
  ];

  return {
    available: { baseline: Boolean(b), current: Boolean(c) },
    source: compareValue(b?.source, c?.source),
    metrics: withoutEmptyMetrics(inputs.map(compareNumericMetric)),
  };
}

function sameIgnoringCase(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").toLocaleLowerCase() === (b ?? "").toLocaleLowerCase();
}
