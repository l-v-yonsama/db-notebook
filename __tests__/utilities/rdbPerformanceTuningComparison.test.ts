import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import type {
  NumericComparison,
  PerformanceTuningComparisonEvidence,
} from "../../src/shared/PerformanceTuningComparison";
import { buildRdbComparison } from "../../src/utilities/rdbPerformanceTuningComparison";
import { rdbContext } from "./performanceTuningComparisonFixtures";

function compare(
  baseline: PerformanceTuningContext,
  current: PerformanceTuningContext
): PerformanceTuningComparisonEvidence {
  return buildRdbComparison({
    baseline,
    current,
    source: {
      baseline: {
        fileName: "baseline.dbn",
        contextSha256: "0".repeat(64),
        selectedAt: "2026-08-27T00:00:00.000Z",
      },
      current: { collectedAt: current.collection.collectedAt },
    },
    generatedAt: "2026-08-27T00:00:00.000Z",
  });
}

function metric(
  evidence: PerformanceTuningComparisonEvidence,
  key: string
): NumericComparison | undefined {
  const engine = evidence.engineSpecific.kind === "rdb" ? evidence.engineSpecific.value : undefined;
  return [...(engine?.metrics ?? []), ...evidence.common.workload.metrics].find(
    (candidate) => candidate.key === key
  );
}

function reasonCodes(evidence: PerformanceTuningComparisonEvidence): string[] {
  return evidence.comparability.reasons.map((reason) => reason.code);
}

function benchmark(requestedRuns: 3 | 5, medianClientElapsedTimeMs: number) {
  return {
    startedAt: "2026-08-27T00:00:00.000Z",
    completedAt: "2026-08-27T00:00:01.000Z",
    requestedRuns,
    completedRuns: requestedRuns,
    samples: Array.from({ length: requestedRuns }, (_, index) => ({ run: index + 1, clientElapsedTimeMs: medianClientElapsedTimeMs })),
    medianClientElapsedTimeMs,
    averageClientElapsedTimeMs: medianClientElapsedTimeMs,
    minClientElapsedTimeMs: medianClientElapsedTimeMs,
    maxClientElapsedTimeMs: medianClientElapsedTimeMs,
    planCollectedBeforeBenchmark: true as const,
    source: "performanceTuningBenchmark" as const,
  };
}

it("keeps 5-run vs 3-run benchmark medians comparable and emits a confidence warning", () => {
  const evidence = compare(
    rdbContext({ benchmark: benchmark(5, 100) }),
    rdbContext({ benchmark: benchmark(3, 20) })
  );
  expect(reasonCodes(evidence)).toContain("BENCHMARK_SAMPLE_COUNT_DIFFERS");
  expect(metric(evidence, "rdb.benchmark.medianClientElapsedTimeMs")).toMatchObject({
    comparability: "comparable",
    improvementPercent: 80,
    assessment: "improved",
  });
});

it("tells the user how to collect a missing Current benchmark", () => {
  const evidence = compare(
    rdbContext({ benchmark: benchmark(5, 100) }),
    rdbContext(),
  );

  expect(metric(evidence, "rdb.benchmark.medianClientElapsedTimeMs")).toMatchObject({
    assessment: "noData",
    missingDataGuidance: {
      action: "Run Benchmark (5 runs) for Current",
    },
  });
  expect(metric(evidence, "rdb.benchmark.medianClientElapsedTimeMs")?.missingDataGuidance?.detail)
    .toContain("automatically collects EXPLAIN ANALYZE first");
});

it("tells the user to replace a baseline that has no benchmark", () => {
  const evidence = compare(
    rdbContext(),
    rdbContext({ benchmark: benchmark(3, 20) }),
  );

  expect(metric(evidence, "rdb.benchmark.medianClientElapsedTimeMs")?.missingDataGuidance).toEqual({
    action: "Select a benchmarked baseline",
    detail: "The baseline has no benchmark. Select or recreate a baseline report containing Benchmark (3 runs).",
  });
});

/** The "after" side of the classic Seq Scan -> Index Scan improvement. */
function improvedContext(): PerformanceTuningContext {
  return rdbContext({
    executionPlan: {
      mode: "analyze",
      format: "json",
      planningTimeMs: 1.4,
      executionTimeMs: 8,
      normalizedPlan: {
        id: "p1",
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
      dominantCostPlanNode: { planNodeId: "p1", metric: "actual", exclusiveValue: 8 },
    },
    tables: [
      {
        schemaName: "public",
        tableName: "orders",
        definition: {
          columns: [],
          constraints: [],
          indexes: [
            { indexName: "orders_pkey", unique: true, primary: true, columns: [{ columnName: "id" }] },
            { indexName: "idx_orders_status", unique: false, columns: [{ columnName: "status" }] },
          ],
        },
        statistics: {
          estimatedRowCount: { value: 100_000, estimated: true, source: "catalog" },
          statisticsUpdatedAt: {
            value: "2026-08-05T00:00:00.000Z",
            estimated: false,
            source: "catalog",
          },
          columns: [],
        },
      },
    ],
    planTableMappings: [
      {
        planNodeId: "p1",
        schemaName: "public",
        tableName: "orders",
        indexName: "idx_orders_status",
        estimatedRows: 20,
        actualRows: 20,
        tableAccessRows: { value: 20, estimated: false, source: "actual plan" },
        tableAccessFraction: { value: 0.0002, estimated: false, source: "actual plan" },
        predicateFilterInputRows: { value: 20, estimated: false, source: "actual plan" },
        predicateFilterOutputRows: { value: 20, estimated: false, source: "actual plan" },
        predicateFilterSelectivity: { value: 1, estimated: false, source: "actual plan" },
      },
    ],
    collection: {
      collectedAt: "2026-08-06T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
  });
}

describe("buildRdbComparison - Seq Scan to Index Scan", () => {
  const evidence = compare(rdbContext(), improvedContext());
  const engine =
    evidence.engineSpecific.kind === "rdb" ? evidence.engineSpecific.value : undefined;

  it("is comparable when only the access path changed", () => {
    expect(evidence.comparability.level).toBe("comparable");
    expect(reasonCodes(evidence)).not.toContain("QUERY_CHANGED");
  });

  it("reports the access path change per table without pairing plan node IDs", () => {
    expect(engine?.accessPath.changed).toBe(true);
    expect(engine?.accessPath.changes).toEqual([
      {
        target: "public.orders",
        baseline: { target: "public.orders", operation: "Seq Scan", indexName: undefined },
        current: {
          target: "public.orders",
          operation: "Index Scan",
          indexName: "idx_orders_status",
        },
        baselineNodeCount: 1,
        currentNodeCount: 1,
        changed: true,
        ambiguous: false,
      },
    ]);
  });

  it("reports the new index as observed in current only, and as newly used", () => {
    expect(evidence.common.indexes.changes).toEqual([
      {
        kind: "observedOnlyInCurrent",
        current: {
          scope: "public.orders",
          indexName: "idx_orders_status",
          kind: undefined,
          unique: false,
          columns: ["status"],
          includedColumns: undefined,
          predicate: undefined,
        },
      },
    ]);
    expect(evidence.common.indexes.unchangedCount).toBe(1);
    expect(evidence.common.indexes.used).toEqual({
      baseline: [],
      current: ["public.orders.idx_orders_status"],
      changed: true,
    });
  });

  it("computes the execution time improvement", () => {
    expect(metric(evidence, "rdb.plan.executionTimeMs")).toMatchObject({
      baseline: 400,
      current: 8,
      improvementPercent: 98,
      assessment: "improved",
      comparability: "comparable",
    });
  });

  it("computes the table access fraction improvement as a percentage point delta too", () => {
    const fraction = metric(evidence, "rdb.table.public.orders.tableAccessFraction");

    expect(fraction?.assessment).toBe("improved");
    expect(fraction?.percentagePointDelta).toBeCloseTo(-99.98, 6);
  });

  it("describes the dominant node by its stable attributes, not its node ID", () => {
    expect(engine?.dominantCostNode).toEqual({
      baseline: "Seq Scan on public.orders",
      current: "Index Scan on public.orders using idx_orders_status",
      changed: true,
    });
  });
});

describe("buildRdbComparison - comparability", () => {
  it("refuses a cross-vendor pair", () => {
    const evidence = compare(
      rdbContext({ database: { vendor: "PostgreSQL", databaseName: "app" } }),
      rdbContext({ database: { vendor: "MySQL", databaseName: "app" } })
    );

    expect(evidence.comparability.level).toBe("notComparable");
    expect(reasonCodes(evidence)).toContain("VENDOR_MISMATCH");
  });

  it("refuses a pair that reads completely different tables", () => {
    const other = rdbContext({
      planTableMappings: [{ planNodeId: "n1", schemaName: "public", tableName: "invoices" }],
    });
    const evidence = compare(rdbContext(), other);

    expect(evidence.comparability.level).toBe("notComparable");
    expect(reasonCodes(evidence)).toContain("TABLE_MISMATCH");
  });

  it("refuses a pair whose statement kinds differ", () => {
    const evidence = compare(
      rdbContext(),
      rdbContext({
        statement: { sql: "DELETE FROM orders", source: "editor", kind: "delete" },
      })
    );

    expect(reasonCodes(evidence)).toContain("STATEMENT_KIND_MISMATCH");
    expect(evidence.comparability.level).toBe("notComparable");
  });

  it("downgrades to partially comparable when the statement text changed", () => {
    const evidence = compare(
      rdbContext(),
      rdbContext({
        statement: {
          sql: "SELECT id\nFROM orders\nWHERE status = 'open' AND region = 'jp'",
          source: "editor",
          kind: "select",
        },
      })
    );

    expect(evidence.comparability.level).toBe("partiallyComparable");
    expect(reasonCodes(evidence)).toContain("QUERY_CHANGED");
    expect(evidence.common.query.changed).toBe(true);
    expect(evidence.common.query.diff.some((line) => line.kind === "added")).toBe(true);
  });

  it("marks execution-only metrics not comparable when one side is estimate-only", () => {
    const estimateOnly = rdbContext({
      statement: { sql: "SELECT id\nFROM orders\nWHERE status = 'open'", source: "editor", kind: "select" },
      executionPlan: {
        mode: "estimate",
        format: "json",
        planningTimeMs: 1.1,
        normalizedPlan: {
          id: "e1",
          depth: 0,
          operation: "Seq Scan",
          relation: { schemaName: "public", tableName: "orders" },
          estimated: { rows: 1_000, totalCost: 900 },
          children: [],
        },
      },
      planTableMappings: [
        { planNodeId: "e1", schemaName: "public", tableName: "orders", estimatedRows: 1_000 },
      ],
    });
    const evidence = compare(estimateOnly, rdbContext());

    expect(reasonCodes(evidence)).toContain("PLAN_MODE_MIXED");
    expect(evidence.comparability.level).toBe("partiallyComparable");

    const executionTime = metric(evidence, "rdb.plan.executionTimeMs");
    expect(executionTime?.comparability).toBe("notComparable");
    expect(executionTime?.improvementPercent).toBeUndefined();
    // The estimate itself is still a like-for-like figure.
    expect(metric(evidence, "rdb.plan.estimatedRows")?.comparability).toBe("comparable");
  });

  it("flags a large optimizer-statistics freshness gap", () => {
    const stale = rdbContext();
    stale.tables[0].statistics!.statisticsUpdatedAt = {
      value: "2026-01-01T00:00:00.000Z",
      estimated: false,
      source: "catalog",
    };
    const evidence = compare(stale, rdbContext());

    expect(reasonCodes(evidence)).toContain("STATISTICS_FRESHNESS_GAP");
  });

  it("always states the environment and point-in-time statistics caveats", () => {
    const codes = reasonCodes(compare(rdbContext(), rdbContext()));

    expect(codes).toContain("ENVIRONMENT_MAY_DIFFER");
    expect(codes).toContain("OPTIMIZER_STATISTICS_POINT_IN_TIME");
  });
});

describe("buildRdbComparison - plan node ambiguity", () => {
  it("does not pair plan nodes when a table is accessed more than once", () => {
    const selfJoin = rdbContext({
      executionPlan: {
        mode: "analyze",
        format: "json",
        executionTimeMs: 50,
        normalizedPlan: {
          id: "j1",
          depth: 0,
          operation: "Nested Loop",
          children: [
            {
              id: "j2",
              depth: 1,
              operation: "Seq Scan",
              relation: { schemaName: "public", tableName: "orders" },
              children: [],
            },
            {
              id: "j3",
              depth: 1,
              operation: "Index Scan",
              relation: { schemaName: "public", tableName: "orders" },
              indexName: "orders_pkey",
              children: [],
            },
          ],
        },
      },
    });
    const evidence = compare(selfJoin, improvedContext());
    const engine =
      evidence.engineSpecific.kind === "rdb" ? evidence.engineSpecific.value : undefined;
    const change = engine?.accessPath.changes.find((c) => c.target === "public.orders");

    expect(change?.ambiguous).toBe(true);
    expect(change?.changed).toBe(false);
    expect(change?.baseline).toBeUndefined();
    expect(change?.baselineNodeCount).toBe(2);
  });
});

describe("buildRdbComparison - workload", () => {
  it("refuses to compare workload statistics from different sources", () => {
    const evidence = compare(
      rdbContext({ workload: { source: "pg_stat_statements", averageElapsedTimeMs: 400 } }),
      rdbContext({ workload: { source: "sqlHistory", averageElapsedTimeMs: 10 } })
    );
    const average = metric(evidence, "rdb.workload.averageElapsedTimeMs");

    expect(average?.comparability).toBe("notComparable");
    expect(average?.baseline).toBe(400);
    expect(average?.current).toBe(10);
    expect(average?.improvementPercent).toBeUndefined();
  });

  it("flags workload statistics present on only one side", () => {
    const evidence = compare(
      rdbContext({ workload: { source: "pg_stat_statements", executionCount: 10 } }),
      rdbContext()
    );

    expect(reasonCodes(evidence)).toContain("WORKLOAD_VS_SINGLE_OBSERVATION");
    expect(evidence.common.workload.available).toEqual({ baseline: true, current: false });
  });
});

describe("buildRdbComparison - metric decisions", () => {
  it("records a decision for every metric it produced", () => {
    const evidence = compare(rdbContext(), improvedContext());
    const engine =
      evidence.engineSpecific.kind === "rdb" ? evidence.engineSpecific.value : undefined;
    const producedKeys = [
      ...evidence.common.workload.metrics,
      ...(engine?.metrics ?? []),
    ].map((m) => m.key);

    expect(evidence.comparability.metricDecisions.map((d) => d.metricKey).sort()).toEqual(
      producedKeys.sort()
    );
  });
});

// --- Code review 2026-08-27 regressions -----------------------------------

describe("buildRdbComparison - a blocking reason suppresses every improvement", () => {
  it("marks all metrics not comparable when the two sides are different databases", () => {
    const evidence = compare(
      rdbContext({ database: { vendor: "PostgreSQL", databaseName: "app" } }),
      improvedContext(),
    );

    expect(evidence.comparability.level).toBe("comparable");

    const crossDb = compare(
      rdbContext({ database: { vendor: "PostgreSQL", databaseName: "app" } }),
      rdbContext({ database: { vendor: "PostgreSQL", databaseName: "other" } }),
    );
    const engine =
      crossDb.engineSpecific.kind === "rdb" ? crossDb.engineSpecific.value : undefined;
    const all = [...crossDb.common.workload.metrics, ...(engine?.metrics ?? [])];

    expect(all.length).toBeGreaterThan(0);
    expect(all.every((m) => m.comparability === "notComparable")).toBe(true);
    expect(all.every((m) => m.assessment === "notComparable")).toBe(true);
    expect(all.every((m) => m.improvementPercent === undefined)).toBe(true);
    expect(all.every((m) => m.percentChange === undefined)).toBe(true);
    // Raw values still travel - §11 allows showing them, just not a verdict.
    expect(all.some((m) => m.baseline !== undefined)).toBe(true);
    // ...and the same is true of the decision list the AI projection reads.
    expect(
      crossDb.comparability.metricDecisions.every((d) => d.comparability === "notComparable"),
    ).toBe(true);
    // Sanity: the same pair without the blocker does produce improvements.
    expect(
      [...evidence.common.workload.metrics, ...(evidence.engineSpecific.kind === "rdb" ? evidence.engineSpecific.value.metrics : [])]
        .some((m) => m.improvementPercent !== undefined),
    ).toBe(true);
  });
});

describe("buildRdbComparison - environment", () => {
  const withEnvironment = (environment: string) =>
    rdbContext({ database: { vendor: "PostgreSQL", databaseName: "app", environment } });

  it("flags a differing environment and refuses timing metrics", () => {
    const evidence = compare(withEnvironment("staging"), withEnvironment("production"));

    expect(reasonCodes(evidence)).toContain("ENVIRONMENT_MISMATCH");
    expect(evidence.comparability.level).toBe("partiallyComparable");
    expect(metric(evidence, "rdb.plan.executionTimeMs")?.comparability).toBe("notComparable");
    expect(metric(evidence, "rdb.plan.planningTimeMs")?.comparability).toBe("notComparable");
    expect(metric(evidence, "rdb.plan.buffersRead")?.comparability).toBe("notComparable");
    // Row counts are a property of the data, not the machine.
    expect(metric(evidence, "rdb.plan.estimatedRows")?.comparability).toBe("comparable");
  });

  it("stays quiet when both sides name the same environment", () => {
    const evidence = compare(withEnvironment("production"), withEnvironment("production"));

    expect(reasonCodes(evidence)).not.toContain("ENVIRONMENT_MISMATCH");
    expect(metric(evidence, "rdb.plan.executionTimeMs")?.comparability).toBe("comparable");
  });

  it("records the environment in the compared target identity", () => {
    const evidence = compare(withEnvironment("staging"), withEnvironment("production"));

    expect(evidence.common.target.baseline?.environment).toBe("staging");
    expect(evidence.common.target.current?.environment).toBe("production");
    expect(evidence.common.target.changed).toBe(true);
  });
});

describe("buildRdbComparison - a table reached by several plan steps", () => {
  const selfJoin = () =>
    rdbContext({
      planTableMappings: [
        { planNodeId: "j2", schemaName: "public", tableName: "orders", estimatedRows: 1_000 },
        { planNodeId: "j3", schemaName: "public", tableName: "orders", estimatedRows: 5 },
      ],
    });

  it("refuses per-table metrics rather than pairing an arbitrary first node", () => {
    const evidence = compare(selfJoin(), rdbContext());
    const tableMetrics = (
      evidence.engineSpecific.kind === "rdb" ? evidence.engineSpecific.value.metrics : []
    ).filter((m) => m.key.startsWith("rdb.table.public.orders."));

    expect(tableMetrics.length).toBeGreaterThan(0);
    expect(tableMetrics.every((m) => m.comparability === "notComparable")).toBe(true);
    expect(tableMetrics[0].reason).toContain("cannot be matched one to one");
    expect(tableMetrics.every((m) => m.improvementPercent === undefined)).toBe(true);
  });

  it("still compares a table reached by exactly one step on both sides", () => {
    const evidence = compare(rdbContext(), improvedContext());

    expect(
      metric(evidence, "rdb.table.public.orders.tableAccessFraction")?.comparability,
    ).toBe("comparable");
  });
});
