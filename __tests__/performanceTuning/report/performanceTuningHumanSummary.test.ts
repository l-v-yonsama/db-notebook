import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { buildPerformanceTuningHumanSummary } from "../../../src/performanceTuning/report/performanceTuningHumanSummary";

function context(overrides: Partial<PerformanceTuningContext> = {}): PerformanceTuningContext {
  return {
    formatVersion: 1,
    database: { vendor: "PostgreSQL", databaseName: "app" },
    statement: {
      sql: "SELECT * FROM orders o WHERE o.status = 'open'",
      source: "editor",
      kind: "select",
      analyzeEligibility: { allowed: true },
    },
    executionPlan: { mode: "analyze", format: "json", executionTimeMs: 12 },
    tables: [
      {
        schemaName: "public",
        tableName: "orders",
        definition: { columns: [], constraints: [], indexes: [] },
        statistics: {
          estimatedRowCount: { value: 10_000, estimated: true, source: "catalog" },
          modificationsSinceAnalyze: { value: 1_500, estimated: true, source: "catalog" },
          columns: [],
        },
        physicalHealth: {
          provider: "PostgreSQL",
          metrics: [
            { name: "deadTuples", value: 2_000 },
            { name: "deadTupleRatio", value: 0.2 },
          ],
        },
      },
    ],
    planTableMappings: [
      {
        planNodeId: "n1",
        schemaName: "public",
        tableName: "orders",
        alias: "o",
        estimatedRows: 100,
        actualRows: 2_000,
        tableAccessRows: { value: 5_000, estimated: false, source: "actual plan" },
        predicateFilterInputRows: { value: 5_000, estimated: false, source: "actual plan" },
        predicateFilterOutputRows: { value: 2_000, estimated: false, source: "actual plan" },
        tableAccessFraction: { value: 0.5, estimated: false, source: "actual plan" },
        predicateFilterSelectivity: { value: 0.4, estimated: false, source: "actual plan" },
      },
    ],
    collection: {
      collectedAt: "2026-08-22T00:00:00.000Z",
      status: "complete",
      diagnostics: [
        {
          code: "CARDINALITY_MISESTIMATE",
          severity: "info",
          affectsCompleteness: false,
          scope: "executionPlan",
          message: "row estimate differs",
          schemaName: "public",
          tableName: "orders",
          cardinality: { estimatedRows: 100, actualRows: 2_000, actualToEstimatedRatio: 20 },
        },
      ],
      unavailableSections: [],
    },
    ...overrides,
  };
}

describe("buildPerformanceTuningHumanSummary", () => {
  it("summarizes measured row flow, estimate mismatch, raw paths, and PostgreSQL maintenance signals", () => {
    const summary = buildPerformanceTuningHumanSummary(context());

    expect(summary.profile).toMatchObject({
      statementKind: "SELECT",
      evidence: "actual",
      tableCount: 1,
      tableRefs: ["public.orders (alias o)"],
      collectionStatus: "complete",
    });
    expect(summary.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "estimateAccuracy", level: "attention" }),
      expect.objectContaining({
        kind: "tableHealth",
        level: "attention",
        summary: expect.stringContaining("VACUUM behavior"),
        rawDataPath: expect.stringContaining("physicalHealth.metrics"),
      }),
    ]));
    expect(summary.rowFlows[0]).toMatchObject({
      tableRef: "public.orders (alias o)",
      totalRows: 10_000,
      totalRowsEstimated: true,
      accessedRows: 5_000,
      filterOutputRows: 2_000,
      planOutputRows: 2_000,
      accessFraction: 0.5,
      filterPassRate: 0.4,
      valuesAreActual: true,
    });
  });

  it("labels DML runtime fields as not measured even when estimate mappings exist", () => {
    const value = context({
      statement: {
        sql: "DELETE FROM orders WHERE status = 'old'",
        source: "editor",
        kind: "delete",
        analyzeEligibility: { allowed: false },
      },
      executionPlan: { mode: "estimate", format: "json" },
      collection: {
        collectedAt: "2026-08-22T00:00:00.000Z",
        status: "complete",
        diagnostics: [],
        unavailableSections: [],
      },
    });
    value.planTableMappings[0].actualRows = undefined;

    const summary = buildPerformanceTuningHumanSummary(value);
    expect(summary.profile.evidence).toBe("estimate");
    expect(summary.rowFlows[0].valuesAreActual).toBe(false);
    expect(summary.signals.find((signal) => signal.kind === "estimateAccuracy")?.summary).toContain("DML");
  });

  it("does not treat missing physical-health metrics as healthy", () => {
    const value = context();
    value.tables[0].physicalHealth = undefined;
    value.tables[0].statistics!.modificationsSinceAnalyze = undefined;

    expect(buildPerformanceTuningHumanSummary(value).signals).toContainEqual(
      expect.objectContaining({ kind: "tableHealth", level: "unknown" }),
    );
  });

  it("ignores high SQL Server fragmentation for small objects", () => {
    const value = context({ database: { vendor: "SQLServer", databaseName: "app" } });
    value.tables[0].physicalHealth = {
      provider: "SQLServer",
      metrics: [
        { name: "avgFragmentationPercent", value: 80 },
        { name: "pageCount", value: 25 },
      ],
    };

    const health = buildPerformanceTuningHumanSummary(value).signals.find(
      (signal) => signal.kind === "tableHealth",
    );
    expect(health?.level).toBe("info");
    expect(health?.summary).toContain("below the page-count threshold");
  });
});
