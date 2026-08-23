import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  actualExecutionEvidenceSource,
  hasActualExecutionEvidence,
} from "../../src/shared/PerformanceTuningActualEvidence";

function context(overrides: Partial<PerformanceTuningContext> = {}): PerformanceTuningContext {
  return {
    formatVersion: 1,
    database: { vendor: "Postgres", databaseName: "app" },
    statement: { sql: "SELECT 1", source: "editor", kind: "select", analyzeEligibility: { allowed: true } },
    executionPlan: { mode: "analyze", format: "json" },
    tables: [],
    planTableMappings: [],
    collection: { collectedAt: "2026-08-23T00:00:00.000Z", status: "complete", diagnostics: [], unavailableSections: [] },
    ...overrides,
  };
}

describe("hasActualExecutionEvidence", () => {
  it("recognizes PostgreSQL normalized EXPLAIN ANALYZE JSON without a separate actualPlan artifact", () => {
    const value = context({
      executionPlan: {
        mode: "analyze",
        format: "json",
        executionTimeMs: 12.068,
        normalizedPlan: {
          id: "n0", depth: 0, operation: "Aggregate", actual: { totalMs: 11.917, rows: 1, loops: 1 }, children: [],
        },
      },
    });

    expect(hasActualExecutionEvidence(value)).toBe(true);
    expect(actualExecutionEvidenceSource(value)).toBe("EXPLAIN (ANALYZE, FORMAT JSON)");
  });

  it("does not treat analyze mode alone as measured runtime evidence", () => {
    expect(hasActualExecutionEvidence(context())).toBe(false);
  });
});
