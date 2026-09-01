// Verifies reports remain self-contained after the baseline file is gone.

import type { NotebookCellData } from "vscode";
import { describe, expect, it } from "vitest";
import type { PerformanceTuningComparisonEvidence } from "../../src/shared/PerformanceTuningComparison";
import { buildDynamoDbAiAnalysisNotebookCells } from "../../src/performanceTuning/aiNotebook/dynamoDbPerformanceTuningNotebook";
import { extractBaselineContext } from "../../src/performanceTuning/comparison/performanceTuningBaselineLoader";
import { buildAiAnalysisNotebookCells } from "../../src/performanceTuning/aiNotebook/performanceTuningAiNotebook";
import { buildComparisonAiInput } from "../../src/performanceTuning/ai/performanceTuningComparisonAiInput";
import { buildRdbComparison } from "../../src/performanceTuning/comparison/rdbPerformanceTuningComparison";
import { buildDynamoDbComparison } from "../../src/performanceTuning/comparison/dynamoDbPerformanceTuningComparison";
import { dbnFileText, dynamoContext, rdbContext } from "./performanceTuningComparisonFixtures";

type BuiltCell = NotebookCellData & { metadata?: { cellLabel?: string } };

const source = (collectedAt: string) => ({
  baseline: {
    fileName: "perf-tuning-analysis-app-20260802-000000.dbn",
    sourcePath: "/ws/reports/performance-tuning/perf-tuning-analysis-app-20260802-000000.dbn",
    contextSha256: "a".repeat(64),
    collectedAt: "2026-08-02T00:00:00.000Z",
    selectedAt: "2026-08-27T00:00:00.000Z",
  },
  current: { collectedAt },
});

function jsonCell(cells: BuiltCell[], label: string): BuiltCell {
  const cell = cells.find((c) => c.metadata?.cellLabel === label);
  expect(cell, `expected a cell labelled "${label}"`).toBeDefined();
  return cell!;
}

function markdownContaining(cells: BuiltCell[], needle: string): string {
  const cell = cells.find((c) => c.value.includes(needle));
  expect(cell, `expected a cell containing "${needle}"`).toBeDefined();
  return cell!.value;
}

function rdbEvidence(): PerformanceTuningComparisonEvidence {
  return buildRdbComparison({
    baseline: rdbContext(),
    current: rdbContext({
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
    }),
    source: source("2026-08-06T00:00:00.000Z"),
    generatedAt: "2026-08-27T00:00:00.000Z",
  });
}

const rdbBenchmark = {
  startedAt: "2026-08-27T00:00:00.000Z",
  completedAt: "2026-08-27T00:00:01.000Z",
  requestedRuns: 3 as const,
  completedRuns: 3,
  samples: [1, 2, 3].map((run) => ({ run, clientElapsedTimeMs: 100 })),
  medianClientElapsedTimeMs: 100,
  averageClientElapsedTimeMs: 100,
  minClientElapsedTimeMs: 100,
  maxClientElapsedTimeMs: 100,
  planCollectedBeforeBenchmark: true as const,
  source: "performanceTuningBenchmark" as const,
};

describe("RDB comparison report", () => {
  const baselineContext = rdbContext();
  const currentContext = rdbContext({
    collection: {
      collectedAt: "2026-08-06T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
  });
  const evidence = rdbEvidence();

  it("saves a comparison report with no AI analysis at all", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];

    expect(cells.some((c) => c.metadata?.cellLabel === "AI analysis JSON")).toBe(false);
    expect(cells.some((c) => c.metadata?.cellLabel === "AI request messages")).toBe(false);
    expect(cells[1].value).toContain("| AI analysis | Not run");
    expect(markdownContaining(cells, "### 4.2. AI summary")).toContain("No AI analysis was run");
    expect(markdownContaining(cells, "## 8. Comparison with baseline")).toBeTruthy();
  });

  it("keeps the existing chapter numbers so already-saved reports' anchors still resolve", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];
    const values = cells.map((c) => c.value);

    expect(values.some((v) => v.includes("## 5. Query structure"))).toBe(true);
    expect(values.some((v) => v.includes("## 6. Execution plan"))).toBe(true);
    expect(values.some((v) => v.includes("## 7. Additional information"))).toBe(true);
  });

  it("stores both contexts and the evidence, so the report survives the baseline file being deleted", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];

    expect(JSON.parse(jsonCell(cells, "Baseline Full context JSON").value)).toEqual(baselineContext);
    expect(JSON.parse(jsonCell(cells, "Current Full context JSON").value)).toEqual(currentContext);
    // Round-tripped through JSON, so keys whose value is undefined are
    // legitimately absent from the saved cell.
    expect(JSON.parse(jsonCell(cells, "Comparison Evidence JSON").value)).toEqual(
      JSON.parse(JSON.stringify(evidence)),
    );
    // The pre-existing unprefixed cell is kept for readers written before
    // this feature (§14).
    expect(JSON.parse(jsonCell(cells, "Full context JSON").value)).toEqual(currentContext);
  });

  it("records the baseline's file name, path, and context digest in the report itself", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];
    const chapter = markdownContaining(cells, "### 8.8. Baseline source");

    expect(chapter).toContain("perf-tuning-analysis-app-20260802-000000.dbn");
    expect(chapter).toContain("a".repeat(64));
    expect(chapter).toContain("/ws/reports/performance-tuning/");
    expect(chapter).toContain("2026-08-27T00:00:00.000Z (local ");
  });

  it("keeps UTC comparison timestamps and appends compact local-time hints", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];
    const chapter = markdownContaining(cells, "### 8.1. Summary");

    expect(chapter).toContain("2026-08-02T00:00:00.000Z (local ");
    expect(chapter).toContain("2026-08-06T00:00:00.000Z (local ");
    expect(chapter).toContain("2026-08-27T00:00:00.000Z (local ");
  });

  it("can be selected as a baseline again, resolving to the Current context", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];
    const file = dbnFileText(
      cells.map((c) => ({ label: c.metadata?.cellLabel, value: c.value, kind: c.kind })),
    );

    const extracted = extractBaselineContext(file);

    expect(extracted.ok).toBe(true);
    expect(extracted.ok && extracted.context).toEqual(currentContext);
  });

  it("shows the improvement figure in the key-changes table", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];
    const chapter = markdownContaining(cells, "### 8.2. Key changes");

    expect(chapter).toContain("Execution time");
    expect(chapter).toContain("98% better");
  });

  it("renders missing Benchmark guidance once instead of repeating its detail for every metric", () => {
    const benchmarkBaseline = rdbContext({ benchmark: rdbBenchmark });
    const benchmarkEvidence = buildRdbComparison({
      baseline: benchmarkBaseline,
      current: currentContext,
      source: source(currentContext.collection.collectedAt),
      generatedAt: "2026-08-28T00:00:00.000Z",
    });
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence: benchmarkEvidence, baselineContext: benchmarkBaseline },
    }) as BuiltCell[];
    const chapter = markdownContaining(cells, "### 8.6. Metric comparison");

    expect(chapter).toContain("▶ Run Benchmark (3 runs) for Current");
    expect(chapter.match(/automatically collects EXPLAIN ANALYZE first/g)).toHaveLength(1);
  });

  it("still builds the original analysis-only report unchanged", () => {
    const analysisOnly = buildAiAnalysisNotebookCells(currentContext, {
      analysis: {
        formatVersion: 1,
        summary: "s",
        findings: [],
        recommendations: [],
        confidence: "medium",
        missingContext: [],
        model: { id: "m", vendor: "copilot", family: "gpt", version: "1" },
        generatedAt: "2026-08-27T00:00:00.000Z",
      },
    }) as BuiltCell[];

    expect(analysisOnly.some((c) => c.value.includes("Comparison with baseline"))).toBe(false);
    expect(analysisOnly.some((c) => c.metadata?.cellLabel === "Baseline Full context JSON")).toBe(
      false,
    );
    expect(analysisOnly.some((c) => c.metadata?.cellLabel === "Current Full context JSON")).toBe(
      false,
    );
  });
});

describe("DynamoDB comparison report", () => {
  const baselineContext = dynamoContext();
  const currentContext = dynamoContext({
    collection: {
      collectedAt: "2026-08-06T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
  });
  const evidence = buildDynamoDbComparison({
    baseline: baselineContext,
    current: currentContext,
    source: source("2026-08-06T00:00:00.000Z"),
    generatedAt: "2026-08-27T00:00:00.000Z",
  });

  it("appends chapter 11 and Appendix C without renumbering the existing chapters", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];
    const values = cells.map((c) => c.value);

    expect(values.some((v) => v.includes("## 10. Additional information"))).toBe(true);
    expect(values.some((v) => v.includes("## 11. Comparison with baseline"))).toBe(true);
    expect(values.some((v) => v.includes("## Appendix C. Comparison raw data"))).toBe(true);
  });

  it("stores both contexts and the evidence", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];

    expect(JSON.parse(jsonCell(cells, "Baseline Full context JSON").value)).toEqual(baselineContext);
    expect(JSON.parse(jsonCell(cells, "Current Full context JSON").value)).toEqual(currentContext);
    // Round-tripped through JSON, so keys whose value is undefined are
    // legitimately absent from the saved cell.
    expect(JSON.parse(jsonCell(cells, "Comparison Evidence JSON").value)).toEqual(
      JSON.parse(JSON.stringify(evidence)),
    );
  });

  it("keeps the three DynamoDB caps on separate rows", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(currentContext, {
      comparison: { evidence, baselineContext },
    }) as BuiltCell[];
    const chapter = markdownContaining(cells, "### 11.4. Access path changes");

    expect(chapter).toContain("DynamoDB API Limit");
    expect(chapter).toContain("Result item cap (panel)");
    expect(chapter).toContain("Observation bound");
  });
});

// --- Code review 2026-08-27 regression ------------------------------------

describe("AI request messages reproduce the request that was actually sent", () => {
  const baselineContext = rdbContext();
  const currentContext = rdbContext({
    collection: {
      collectedAt: "2026-08-06T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
  });

  const analysis = {
    formatVersion: 1 as const,
    summary: "s",
    findings: [],
    recommendations: [],
    confidence: "medium" as const,
    missingContext: [],
    model: { id: "m", vendor: "copilot", family: "gpt", version: "1" },
    request: {
      promptFormatVersion: 1 as const,
      translateResponse: false,
      language: "en",
      contextDetail: "full" as const,
      comparison: {
        detail: "noDiffHunks" as const,
        omittedFields: ["common.query.diff"],
        baselineFileName: "older-baseline.dbn",
        baselineContextSha256: "b".repeat(64),
      },
    },
    generatedAt: "2026-08-27T00:00:00.000Z",
  };

  it("embeds the pinned Comparison Input verbatim rather than re-projecting the evidence", () => {
    // The comparison chapter is about a *different*, newer baseline than the
    // one the analysis was run against - which is exactly the case where a
    // rebuild would fabricate a prompt that was never sent.
    const newerEvidence = rdbEvidence();
    const sentInput = buildComparisonAiInput(
      buildRdbComparison({
        baseline: rdbContext({
          statement: {
            sql: "SELECT id FROM orders WHERE status = 'ANCIENT BASELINE'",
            source: "editor",
            kind: "select",
          },
        }),
        current: currentContext,
        source: source("2026-08-06T00:00:00.000Z"),
        generatedAt: "2026-08-27T00:00:00.000Z",
      }),
      "noDiffHunks",
    );

    const cells = buildAiAnalysisNotebookCells(currentContext, {
      analysis,
      comparison: { evidence: newerEvidence, baselineContext },
      analysisComparisonInput: sentInput,
    }) as BuiltCell[];

    const sent = jsonCell(cells, "AI request messages").value;
    // "ANCIENT BASELINE" exists only in the pinned input, never in the newer
    // evidence the comparison chapter is built from - so its presence proves
    // the cell reproduced the sent request instead of re-projecting.
    expect(sent).toContain("ANCIENT BASELINE");
    // The pinned rung dropped the diff hunks, and the reproduction keeps that.
    expect(sentInput.query.diffHunks).toBeUndefined();
    expect(sent).not.toContain("diffHunks");
    // The recorded shrink rung travels with it.
    expect(JSON.parse(sent).comparison).toEqual(analysis.request.comparison);
  });

  it("omits the comparison section entirely when the analysis ran without one", () => {
    const cells = buildAiAnalysisNotebookCells(currentContext, {
      analysis: { ...analysis, request: { ...analysis.request, comparison: undefined } },
      comparison: { evidence: rdbEvidence(), baselineContext },
    }) as BuiltCell[];

    const sent = jsonCell(cells, "AI request messages").value;
    expect(sent).not.toContain("# Comparison input (JSON)");
    expect(JSON.parse(sent).comparison).toBeUndefined();
  });
});
