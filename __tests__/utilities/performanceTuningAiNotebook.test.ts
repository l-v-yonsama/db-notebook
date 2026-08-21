import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { NotebookCellKind, Uri, window, workspace } from "vscode";
import type {
  PerformanceTuningAiAnalysisResult,
} from "../../src/shared/PerformanceTuningAiAnalysis";
import {
  buildAiAnalysisNotebookCells,
  buildAiAnalysisNotebookFilename,
  saveAiAnalysisAsNotebook,
} from "../../src/utilities/performanceTuningAiNotebook";

// Same cast-through-unknown workaround as fsUtil.test.ts / cfnDiagramPreviewNotebook.test.ts
// - workspaceFolders is typed readonly on the real vscode.d.ts this import resolves to.
type MockWorkspaceFolders = { uri: Uri; name?: string; index?: number }[] | undefined;
const setWorkspaceFolders = (folders: MockWorkspaceFolders): void => {
  (workspace as unknown as { workspaceFolders: MockWorkspaceFolders }).workspaceFolders = folders;
};

function buildContext(overrides: Partial<PerformanceTuningContext> = {}): PerformanceTuningContext {
  return {
    formatVersion: 1,
    database: { vendor: "postgresql", databaseName: "app" },
    statement: { sql: "SELECT * FROM orders WHERE tenant_id = 42", source: "editor" },
    executionPlan: { mode: "estimate", format: "json" },
    tables: [],
    planTableMappings: [],
    collection: {
      collectedAt: "2026-08-18T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
    ...overrides,
  };
}

function buildAnalysis(
  overrides: Partial<PerformanceTuningAiAnalysisResult> = {}
): PerformanceTuningAiAnalysisResult {
  return {
    formatVersion: 1,
    summary: "The query does a full scan on orders.",
    findings: [
      {
        title: "Full table scan",
        detail: "The plan reads all rows of orders.",
        severity: "warning",
        evidence: { tableName: "orders", planNodeId: "n0" },
      },
    ],
    recommendations: [
      {
        title: "Add an index on tenant_id",
        detail: "Create an index on orders.tenant_id.",
        rationale: "The predicate filters on tenant_id but no matching index exists.",
        riskLevel: "low",
        suggestedSql: "CREATE INDEX idx_orders_tenant_id ON orders (tenant_id);",
        evidence: { tableName: "orders" },
      },
    ],
    confidence: "medium",
    missingContext: ["An ANALYZE plan would confirm the actual row counts."],
    model: { id: "gpt-4o", vendor: "copilot", family: "gpt-4o", version: "1" },
    generatedAt: "2026-08-18T00:05:00.000Z",
    ...overrides,
  };
}

describe("buildAiAnalysisNotebookFilename", () => {
  it("sanitizes non-alphanumeric characters in the database name and embeds a timestamp", () => {
    const now = new Date(2026, 7, 18, 9, 5, 3); // 2026-08-18 09:05:03 local
    const filename = buildAiAnalysisNotebookFilename("my app!/db", now);
    expect(filename).toBe("perf-tuning-analysis-my_app_db-20260818-090503.dbn");
  });

  it("falls back to 'db' when the database name has no safe characters", () => {
    const now = new Date(2026, 7, 18, 0, 0, 0);
    expect(buildAiAnalysisNotebookFilename("!!!", now)).toBe(
      "perf-tuning-analysis-db-20260818-000000.dbn"
    );
  });
});

describe("buildAiAnalysisNotebookCells", () => {
  it("builds three markdown cells (overview + analysis + JSON appendix intro) followed by two JSON code cells", () => {
    const cells = buildAiAnalysisNotebookCells(buildContext(), buildAnalysis());

    expect(cells).toHaveLength(5);
    expect(cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(cells[0].languageId).toBe("markdown");
    expect(cells[0].value).toContain("SELECT * FROM orders WHERE tenant_id = 42");

    expect(cells[1].kind).toBe(NotebookCellKind.Markup);
    expect(cells[1].languageId).toBe("markdown");
    expect(cells[1].value).toContain("### Findings");
    expect(cells[1].value).toContain("### Recommendations");
    expect(cells[1].value).toContain("### Missing context");
    expect(cells[1].value).toContain("Full table scan");
    expect(cells[1].value).toContain("Add an index on tenant_id");
    expect(cells[1].value).toContain("An ANALYZE plan would confirm the actual row counts.");

    expect(cells[2].kind).toBe(NotebookCellKind.Markup);
    expect(cells[2].languageId).toBe("markdown");
    expect(cells[2].value).toContain("Full context JSON");
    expect(cells[2].value).toContain("AI analysis JSON");

    expect(cells[3].kind).toBe(NotebookCellKind.Code);
    expect(cells[3].languageId).toBe("json");
    expect(JSON.parse(cells[3].value)).toMatchObject({ database: { databaseName: "app" } });
    expect(cells[3].metadata).toEqual({ cellLabel: "Full context JSON" });

    expect(cells[4].kind).toBe(NotebookCellKind.Code);
    expect(cells[4].languageId).toBe("json");
    expect(JSON.parse(cells[4].value)).toMatchObject({ summary: "The query does a full scan on orders." });
    expect(cells[4].metadata).toEqual({ cellLabel: "AI analysis JSON" });
  });

  // 2026-08-21 follow-up (summary.md's Full Context improvement item 4) -
  // possibleDuplicateOfIndex is host-computed upstream (PerformanceTuningPreviewPanel.ts),
  // already a plain string on the recommendation by the time this renders.
  it("renders possibleDuplicateOfIndex in its own recommendations-table column when set, and '-' when absent", () => {
    const withDuplicate = buildAiAnalysisNotebookCells(
      buildContext(),
      buildAnalysis({
        recommendations: [
          {
            title: "Add an index on category",
            detail: "Create an index on products.category.",
            rationale: "The predicate filters on category.",
            riskLevel: "medium",
            suggestedSql: "CREATE INDEX idx_products_category ON products (category);",
            possibleDuplicateOfIndex: "idx_products_category",
          },
        ],
      })
    );
    expect(withDuplicate[1].value).toContain("Possible duplicate");
    expect(withDuplicate[1].value).toContain("`idx_products_category`");

    const withoutDuplicate = buildAiAnalysisNotebookCells(buildContext(), buildAnalysis());
    // The default fixture's recommendation has no possibleDuplicateOfIndex -
    // its table row must still render a "-" placeholder cell, not an empty one.
    expect(withoutDuplicate[1].value).toMatch(/\| Add an index on tenant_id \|.*\| - \|/);
  });

  it("renders 'No findings/recommendations were reported' placeholders instead of empty tables", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext(),
      buildAnalysis({ findings: [], recommendations: [] })
    );
    expect(cells[1].value).toContain("No findings were reported");
    expect(cells[1].value).toContain("No recommendations were reported");
  });

  it("omits the execution plan cell entirely when there is neither a plan nor any table mappings (default fixture)", () => {
    const cells = buildAiAnalysisNotebookCells(buildContext(), buildAnalysis());
    // Same 5-cell shape as the first test above - explicit here so this
    // invariant has its own name/intent rather than relying on that count.
    expect(cells.every((c) => !c.value.includes("## Execution plan"))).toBe(true);
  });

  it("inserts an 'Execution plan' cell right after Overview and before Analysis when a normalizedPlan is present", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({
        executionPlan: {
          mode: "estimate",
          format: "json",
          normalizedPlan: {
            id: "n0",
            depth: 0,
            operation: "Seq Scan",
            relation: { tableName: "orders" },
            estimated: { rows: 50 },
            children: [],
          },
        },
        planTableMappings: [{ planNodeId: "n0", tableName: "orders", estimatedRows: 50 }],
      }),
      buildAnalysis()
    );

    expect(cells).toHaveLength(6);
    expect(cells[1].kind).toBe(NotebookCellKind.Markup);
    expect(cells[1].value).toContain("## Execution plan");
    expect(cells[1].value).toContain("```text");
    expect(cells[1].value).toContain("Seq Scan");
    expect(cells[1].value).toContain("### Tables referenced by this plan");
    expect(cells[1].value).toContain("| orders |");
    // Everything else just shifts down by one - Analysis is now cells[2].
    expect(cells[2].value).toContain("### Findings");
  });

  it("still adds the execution plan cell for table mappings alone, with no normalizedPlan", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({ planTableMappings: [{ planNodeId: "n0", tableName: "orders" }] }),
      buildAnalysis()
    );
    expect(cells).toHaveLength(6);
    expect(cells[1].value).toContain("## Execution plan");
    expect(cells[1].value).not.toContain("```text");
    expect(cells[1].value).toContain("### Tables referenced by this plan");
  });

  it("includes Actual rows/ratio columns in the table when an analyze-mode mapping has them", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({
        planTableMappings: [
          { planNodeId: "n0", tableName: "orders", estimatedRows: 50, actualRows: 37, rowEstimateRatio: 0.74 },
        ],
      }),
      buildAnalysis()
    );
    expect(cells[1].value).toContain("| Table | Index | Est. rows | Actual rows | Est./actual ratio | Columns used |");
    expect(cells[1].value).toContain("| orders | - | 50 | 37 | 0.74x |");
  });

  it("adds an actual-plan subsection when a MySQL artifact is present", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({
        executionPlan: {
          mode: "analyze",
          format: "json",
          actualPlan: {
            source: "EXPLAIN ANALYZE",
            format: "text",
            content: "-> Filter: (status = 'shipped')  (actual time=0.05..1.2 rows=5 loops=1)",
          },
        },
        planTableMappings: [{ planNodeId: "n0", tableName: "orders" }],
      }),
      buildAnalysis()
    );
    expect(cells[1].value).toContain("### Actual execution plan (EXPLAIN ANALYZE)");
    expect(cells[1].value).toContain("actual time=0.05..1.2 rows=5 loops=1");
  });

  it("adds the execution plan cell for an actual-plan artifact alone, with no normalizedPlan or table mappings", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({
        executionPlan: {
          mode: "analyze",
          format: "json",
          actualPlan: { source: "EXPLAIN ANALYZE", format: "text", content: "-> Table scan on orders" },
        },
      }),
      buildAnalysis()
    );
    expect(cells).toHaveLength(6);
    expect(cells[1].value).toContain("## Execution plan");
    expect(cells[1].value).toContain("### Actual execution plan (EXPLAIN ANALYZE)");
    expect(cells[1].value).not.toContain("### Tables referenced by this plan");
  });
});

describe("saveAiAnalysisAsNotebook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWorkspaceFolders([{ uri: Uri.file("/workspace") }]);
    (workspace.openNotebookDocument as Mock).mockResolvedValue({
      uri: Uri.file("/workspace/reports/performance-tuning/whatever.dbn"),
    });
  });

  it("returns ok:false and writes nothing when no workspace folder is open", async () => {
    setWorkspaceFolders(undefined);

    const result = await saveAiAnalysisAsNotebook(buildContext(), buildAnalysis());

    expect(result.ok).toBe(false);
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("creates the reports/performance-tuning directory and writes the notebook there", async () => {
    const result = await saveAiAnalysisAsNotebook(buildContext(), buildAnalysis());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.relativePath.replace(/\\/g, "/")).toMatch(
      /^reports\/performance-tuning\/perf-tuning-analysis-app-\d{8}-\d{6}\.dbn$/
    );

    expect(workspace.fs.createDirectory).toHaveBeenCalledTimes(1);
    const [dirUri] = (workspace.fs.createDirectory as Mock).mock.calls[0];
    expect((dirUri as Uri).fsPath.replace(/\\/g, "/")).toBe("/workspace/reports/performance-tuning");

    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    const [fileUri] = (workspace.fs.writeFile as Mock).mock.calls[0];
    expect((fileUri as Uri).fsPath.replace(/\\/g, "/")).toContain(
      "/workspace/reports/performance-tuning/perf-tuning-analysis-app-"
    );

    expect(workspace.openNotebookDocument).toHaveBeenCalledTimes(1);
    expect(window.showNotebookDocument).toHaveBeenCalledWith(expect.anything(), { viewColumn: 2 });
  });

  it("picks a different filename when the timestamped path already exists", async () => {
    (workspace.fs.stat as Mock).mockResolvedValueOnce({} as never);

    const result = await saveAiAnalysisAsNotebook(buildContext(), buildAnalysis());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.relativePath).not.toMatch(/^reports\/performance-tuning\/perf-tuning-analysis-app-\d{8}-\d{6}\.dbn$/);
    expect(result.relativePath.replace(/\\/g, "/")).toMatch(
      /^reports\/performance-tuning\/perf-tuning-analysis-app-\d{8}-\d{6}-\d+\.dbn$/
    );
  });
});
