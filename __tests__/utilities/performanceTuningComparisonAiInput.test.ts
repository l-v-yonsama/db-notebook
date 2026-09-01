// Verifies AI data boundaries and the explicit shrink ladder.

import { describe, expect, it } from "vitest";
import type { PerformanceTuningComparisonEvidence } from "../../src/shared/PerformanceTuningComparison";
import { buildDynamoDbComparison } from "../../src/utilities/dynamoDbPerformanceTuningComparison";
import {
  buildComparisonAiInput,
  buildComparisonInstructions,
  COMPARISON_AI_INPUT_DETAILS,
} from "../../src/utilities/performanceTuningComparisonAiInput";
import { buildAiAnalysisPrompt, buildPlainTextAnalysisPrompt } from "../../src/utilities/performanceTuningAiPrompt";
import {
  buildDynamoDbAiAnalysisPrompt,
  buildDynamoDbPlainTextAnalysisPrompt,
} from "../../src/utilities/dynamoDbPerformanceTuningAiPrompt";
import { buildRdbComparison } from "../../src/utilities/rdbPerformanceTuningComparison";
import { dynamoContext, rdbContext } from "./performanceTuningComparisonFixtures";

const source = {
  baseline: {
    fileName: "baseline.dbn",
    contextSha256: "a".repeat(64),
    collectedAt: "2026-08-02T00:00:00.000Z",
    selectedAt: "2026-08-27T00:00:00.000Z",
  },
  current: { collectedAt: "2026-08-06T00:00:00.000Z" },
};

/** A baseline whose tables carry definitions and statistics worth not sending. */
function fatBaseline() {
  const context = rdbContext();
  context.tables[0].definition!.ddl = "CREATE TABLE public.orders (id int, secret_column text)";
  context.executionPlan.vendorPlan = { hugeVendorArtifact: "x".repeat(500) };
  return context;
}

function rdbEvidence(): PerformanceTuningComparisonEvidence {
  return buildRdbComparison({
    baseline: fatBaseline(),
    current: rdbContext({
      statement: {
        sql: "SELECT id\nFROM orders\nWHERE status = 'open'\nORDER BY id",
        source: "editor",
        kind: "select",
      },
      executionPlan: {
        mode: "analyze",
        format: "json",
        planningTimeMs: 1.2,
        executionTimeMs: 8,
        normalizedPlan: {
          id: "p1",
          depth: 0,
          operation: "Index Scan",
          relation: { schemaName: "public", tableName: "orders" },
          indexName: "idx_orders_status",
          estimated: { rows: 20, totalCost: 12 },
          actual: { rows: 20, totalMs: 8, loops: 1 },
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
        },
      ],
    }),
    source,
    generatedAt: "2026-08-27T00:00:00.000Z",
  });
}

describe("buildComparisonAiInput", () => {
  const evidence = rdbEvidence();

  it("never carries the baseline's table definitions, statistics, or raw vendor plan", () => {
    const serialized = JSON.stringify(buildComparisonAiInput(evidence));

    expect(serialized).not.toContain("secret_column");
    expect(serialized).not.toContain("hugeVendorArtifact");
    expect(serialized).not.toContain("estimatedRowCount");
  });

  it("declares what it left out rather than dropping it silently", () => {
    const input = buildComparisonAiInput(evidence);

    expect(input.omittedFields).toContain("baseline.tables[].definition");
    expect(input.omittedFields).toContain("baseline.executionPlan.vendorPlan");
    expect(input.omissionReason).toBeTruthy();
  });

  it("keeps both query bodies at every rung of the shrink ladder", () => {
    for (const detail of COMPARISON_AI_INPUT_DETAILS) {
      const input = buildComparisonAiInput(evidence, detail);

      expect(input.query.baselineText).toContain("SELECT id");
      expect(input.query.currentText).toContain("ORDER BY id");
    }
  });

  it("drops only the diff hunks at the second rung, and records that", () => {
    const full = buildComparisonAiInput(evidence, "full");
    const noHunks = buildComparisonAiInput(evidence, "noDiffHunks");

    expect(full.query.diffHunks?.length).toBeGreaterThan(0);
    expect(noHunks.query.diffHunks).toBeUndefined();
    expect(noHunks.omittedFields).toContain("common.query.diff");
    expect(noHunks.collection).toBeDefined();
  });

  it("drops collection differences and comparable-level notes at the last rung", () => {
    const minimal = buildComparisonAiInput(evidence, "minimal");

    expect(minimal.collection).toBeUndefined();
    expect(minimal.omittedFields).toContain("common.collection");
    expect(minimal.comparability.reasons.every((r) => r.level !== "comparable")).toBe(true);
  });

  it("carries the already-computed differences, access path, and index changes", () => {
    const input = buildComparisonAiInput(evidence);

    expect(input.metrics.some((m) => m.key === "rdb.plan.executionTimeMs")).toBe(true);
    expect(input.metrics.find((m) => m.key === "rdb.plan.executionTimeMs")?.improvementPercent).toBe(98);
    expect(input.accessPath[0]).toMatchObject({
      target: "public.orders",
      baseline: "Seq Scan",
      current: "Index Scan using idx_orders_status",
      changed: true,
    });
    expect(input.indexes.changes[0].observation).toBe("not in baseline, observed in current");
  });

  it("lists a rejected metric with its reason instead of its numbers", () => {
    const mixed = buildRdbComparison({
      baseline: rdbContext({
        executionPlan: {
          mode: "estimate",
          format: "json",
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
      }),
      current: rdbContext(),
      source,
      generatedAt: "2026-08-27T00:00:00.000Z",
    });
    const input = buildComparisonAiInput(mixed);

    const rejected = input.comparability.rejectedMetrics.find(
      (m) => m.metricKey === "rdb.plan.executionTimeMs"
    );
    expect(rejected?.reason).toContain("estimate");
    expect(input.metrics.some((m) => m.key === "rdb.plan.executionTimeMs")).toBe(false);

    const minimal = buildComparisonAiInput(mixed, "minimal");
    expect(minimal.comparability.rejectedMetrics).toEqual([]);
    expect(
      minimal.comparability.rejectedMetricGroups?.some(
        (group) =>
          group.metricKeys.includes("rdb.plan.executionTimeMs") &&
          group.reason?.includes("estimate"),
      ),
    ).toBe(true);
  });

  it("names the three DynamoDB caps separately", () => {
    const dynamo = dynamoContext();
    dynamo.accessPattern.limit = 100;
    dynamo.accessPattern.resultItemLimit = 500;
    const evidenceDynamo = buildDynamoDbComparison({
      baseline: dynamo,
      current: dynamoContext(),
      source,
      generatedAt: "2026-08-27T00:00:00.000Z",
    });
    const input = buildComparisonAiInput(evidenceDynamo);

    expect(Object.keys(input.structure)).toEqual(
      expect.arrayContaining(["dynamoDbApiLimit", "queryPanelResultItemCap"])
    );
  });
});

describe("buildComparisonInstructions", () => {
  it("tells the model not to recompute or to claim causation", () => {
    const rdb = buildComparisonInstructions("rdb");

    expect(rdb).toContain("Do not recalculate");
    expect(rdb).toContain("not as its proven cause");
    expect(rdb).toContain("do not assume anything about what it said");
  });

  it("keeps the two engines' guardrails apart", () => {
    const rdb = buildComparisonInstructions("rdb");
    const dynamo = buildComparisonInstructions("dynamodb");

    expect(rdb).toContain("Plan node ids are not stable");
    expect(rdb).not.toContain("CloudWatch");
    expect(dynamo).toContain("not a measured zero");
    expect(dynamo).not.toContain("Optimizer estimates");
  });
});

describe("prompt assembly", () => {
  const evidence = rdbEvidence();
  const comparison = buildComparisonAiInput(evidence);
  const context = rdbContext();

  it("adds the comparison section and instructions only when a comparison is supplied", () => {
    const without = buildAiAnalysisPrompt(context);
    const with_ = buildAiAnalysisPrompt(context, { comparison });

    expect(without.user).not.toContain("# Comparison input (JSON)");
    expect(without.assistant).not.toContain("# Before/after comparison");
    expect(with_.user).toContain("# Comparison input (JSON)");
    expect(with_.assistant).toContain("# Before/after comparison");
  });

  it("never concatenates the baseline's full context into the prompt", () => {
    const prompt = buildAiAnalysisPrompt(context, { comparison });

    expect(prompt.user).not.toContain("secret_column");
    expect(prompt.user).not.toContain("hugeVendorArtifact");
  });

  it("gives the external-AI path the same comparison input as the Copilot path", () => {
    const copilot = buildAiAnalysisPrompt(context, { comparison });
    const external = buildPlainTextAnalysisPrompt(context, { comparison });

    expect(external).toContain(JSON.stringify(comparison, null, 2));
    expect(copilot.user).toContain(JSON.stringify(comparison, null, 2));
    expect(external).toContain("# Before/after comparison");
  });

  it("does the same for DynamoDB, with the DynamoDB guardrails", () => {
    const dynamo = dynamoContext();
    const dynamoComparison = buildComparisonAiInput(
      buildDynamoDbComparison({
        baseline: dynamo,
        current: dynamoContext(),
        source,
        generatedAt: "2026-08-27T00:00:00.000Z",
      })
    );
    const copilot = buildDynamoDbAiAnalysisPrompt(dynamo, { comparison: dynamoComparison });
    const external = buildDynamoDbPlainTextAnalysisPrompt(dynamo, { comparison: dynamoComparison });

    expect(copilot.assistant).toContain("not a measured zero");
    expect(copilot.assistant).not.toContain("Plan node ids are not stable");
    expect(copilot.user).toContain("# Comparison input (JSON)");
    expect(external).toContain("# Comparison input (JSON)");
  });
});
