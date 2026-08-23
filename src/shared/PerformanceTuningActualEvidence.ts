import type {
  PerformanceTuningContext,
  PlanNode,
} from "@l-v-yonsama/multi-platform-database-drivers";

function planHasActualValues(node: PlanNode | undefined): boolean {
  return node?.actual !== undefined || Boolean(node?.children.some(planHasActualValues));
}

/**
 * True only when the collected context contains runtime evidence from a real
 * execution. PostgreSQL carries that evidence directly in normalizedPlan's
 * `actual` fields, unlike vendors that also expose a separate text/XML
 * `actualPlan` artifact.
 */
export function hasActualExecutionEvidence(context: PerformanceTuningContext): boolean {
  if (context.statement.analyzeEligibility?.allowed === false || context.executionPlan.mode !== "analyze") {
    return false;
  }
  return Boolean(
    context.executionPlan.actualPlan ||
    context.executionPlan.executionTimeMs !== undefined ||
    planHasActualValues(context.executionPlan.normalizedPlan) ||
    context.planTableMappings.some((mapping) =>
      mapping.actualRows !== undefined ||
      mapping.tableAccessRows?.estimated === false ||
      mapping.predicateFilterInputRows?.estimated === false ||
      mapping.predicateFilterOutputRows?.estimated === false,
    ),
  );
}

/** A human-readable source label for runtime evidence without an artifact. */
export function actualExecutionEvidenceSource(context: PerformanceTuningContext): string | undefined {
  if (!hasActualExecutionEvidence(context)) {
    return undefined;
  }
  if (context.executionPlan.actualPlan) {
    return context.executionPlan.actualPlan.source;
  }
  if (context.database.vendor.toLocaleLowerCase().includes("postgre")) {
    return "EXPLAIN (ANALYZE, FORMAT JSON)";
  }
  return "database runtime plan";
}
