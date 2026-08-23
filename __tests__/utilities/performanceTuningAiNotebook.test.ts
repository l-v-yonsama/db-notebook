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

type BuiltCell = ReturnType<typeof buildAiAnalysisNotebookCells>[number];

function findCell(cells: BuiltCell[], text: string): BuiltCell {
  const cell = cells.find((candidate) => candidate.value.includes(text));
  expect(cell, `Expected a notebook cell containing ${text}`).toBeDefined();
  return cell!;
}

function findJsonCell(cells: BuiltCell[], label: string): BuiltCell {
  const cell = cells.find((candidate) => candidate.metadata?.cellLabel === label);
  expect(cell, `Expected the ${label} JSON cell`).toBeDefined();
  return cell!;
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
  it("builds overview, human snapshot, analysis, appendix, and the three reproducibility JSON cells", () => {
    const cells = buildAiAnalysisNotebookCells(buildContext(), buildAnalysis());

    expect(cells).toHaveLength(7);
    expect(cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(cells[0].languageId).toBe("markdown");
    expect(cells[0].value).toContain("SELECT * FROM orders WHERE tenant_id = 42");

    expect(cells[1].kind).toBe(NotebookCellKind.Markup);
    expect(cells[1].languageId).toBe("markdown");
    expect(cells[1].value).toContain("## Performance snapshot");

    expect(cells[2].value).toContain("### Findings");
    expect(cells[2].value).toContain("### Recommendations");
    expect(cells[2].value).toContain("### Missing context");
    expect(cells[2].value).toContain("Full table scan");
    expect(cells[2].value).toContain("Add an index on tenant_id");
    expect(cells[2].value).toContain("An ANALYZE plan would confirm the actual row counts.");

    expect(cells[3].kind).toBe(NotebookCellKind.Markup);
    expect(cells[3].languageId).toBe("markdown");
    expect(cells[3].value).toContain("Full context JSON");
    expect(cells[3].value).toContain("AI request messages");
    expect(cells[3].value).toContain("AI analysis JSON");

    expect(cells[4].kind).toBe(NotebookCellKind.Code);
    expect(cells[4].languageId).toBe("json");
    expect(JSON.parse(cells[4].value)).toMatchObject({ database: { databaseName: "app" } });
    expect(cells[4].metadata).toEqual({ cellLabel: "Full context JSON" });

    expect(cells[5].kind).toBe(NotebookCellKind.Code);
    expect(cells[5].languageId).toBe("json");
    expect(JSON.parse(cells[5].value)).toMatchObject({
      model: { id: "gpt-4o" },
      messages: [
        { role: "assistant" },
        { role: "user", content: expect.stringContaining("SELECT * FROM orders") },
      ],
    });
    expect(cells[5].metadata).toEqual({ cellLabel: "AI request messages" });

    expect(cells[6].kind).toBe(NotebookCellKind.Code);
    expect(cells[6].languageId).toBe("json");
    expect(JSON.parse(cells[6].value)).toMatchObject({ summary: "The query does a full scan on orders." });
    expect(cells[6].metadata).toEqual({ cellLabel: "AI analysis JSON" });
  });

  it("records whether the AI request used full or compact input in the overview", () => {
    const analysis = buildAnalysis({
      request: { promptFormatVersion: 1, translateResponse: false, language: "en", contextDetail: "compact" },
    });
    expect(buildAiAnalysisNotebookCells(buildContext(), analysis)[0].value).toContain(
      "Compact (raw vendor artifacts omitted for model limit)"
    );
  });

  it("lists query-relevant indexes directly below the saved query structure diagram", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({
        statement: {
          sql: "SELECT * FROM orders o WHERE o.created_at >= '2026-01-01'",
          source: "editor",
        },
        tables: [
          {
            schemaName: "public",
            tableName: "orders",
            definition: {
              columns: [
                { columnName: "id", dataType: "bigint", nullable: false },
                { columnName: "created_at", dataType: "timestamp", nullable: false },
              ],
              constraints: [{ type: "primaryKey", columns: ["id"] }],
              indexes: [
                {
                  indexName: "idx_orders_created_at",
                  unique: false,
                  primary: false,
                  columns: [{ columnName: "created_at", direction: "asc" }],
                },
              ],
            },
          },
        ],
        planTableMappings: [
          {
            planNodeId: "n0",
            schemaName: "public",
            tableName: "orders",
            alias: "o",
            indexName: "idx_orders_created_at",
            filterColumns: ["created_at"],
          },
        ],
      }),
      buildAnalysis(),
    );

    const structureCell = findCell(cells, "## Query structure");
    expect(structureCell.value).toContain("### Indexes relevant to this SQL");
    expect(structureCell.value).toContain(
      "| public.orders (alias o) | idx_orders_created_at | created_at | - | plan access; WHERE |",
    );
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
    const analysisCell = findCell(withDuplicate, "### Recommendations");
    expect(analysisCell.value).toContain("Possible duplicate");
    expect(analysisCell.value).toContain("`idx_products_category`");

    const withoutDuplicate = buildAiAnalysisNotebookCells(buildContext(), buildAnalysis());
    // The default fixture's recommendation has no possibleDuplicateOfIndex -
    // its table row must still render a "-" placeholder cell, not an empty one.
    expect(findCell(withoutDuplicate, "### Recommendations").value).toMatch(/\| Add an index on tenant_id \|.*\| - \|/);
  });

  it("renders 'No findings/recommendations were reported' placeholders instead of empty tables", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext(),
      buildAnalysis({ findings: [], recommendations: [] })
    );
    expect(findCell(cells, "### Findings").value).toContain("No findings were reported");
    expect(findCell(cells, "### Recommendations").value).toContain("No recommendations were reported");
  });

  it("rebuilds the saved request with the language option used by the original analysis", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext(),
      buildAnalysis({
        request: { promptFormatVersion: 1, translateResponse: true, language: "ja", contextDetail: "full" },
      })
    );
    const request = JSON.parse(findJsonCell(cells, "AI request messages").value);
    expect(request.messages[0].content).toContain("following language: ja");
  });

  it("rebuilds the compact request actually sent to a token-limited model while retaining raw XML in Full context JSON", () => {
    const context = buildContext({
      executionPlan: {
        mode: "analyze",
        format: "json",
        vendorPlan: { raw: "SHOWPLAN_ALL" },
        actualPlan: {
          source: "SET STATISTICS XML",
          format: "xml",
          content: "<ShowPlanXML><RelOp ActualRows=\"150\" /></ShowPlanXML>",
        },
      },
    });
    const cells = buildAiAnalysisNotebookCells(
      context,
      buildAnalysis({
        request: { promptFormatVersion: 1, translateResponse: false, language: "en", contextDetail: "compact" },
      })
    );
    const fullContext = findJsonCell(cells, "Full context JSON").value;
    const request = JSON.parse(findJsonCell(cells, "AI request messages").value);
    expect(fullContext).toContain("ActualRows");
    expect(request.messages[1].content).toContain("contentOmittedFromAiInput");
    expect(request.messages[1].content).not.toContain("ActualRows");
    expect(request.messages[1].content).not.toContain("SHOWPLAN_ALL");
  });

  it("omits the execution plan cell entirely when there is neither a plan nor any table mappings (default fixture)", () => {
    const cells = buildAiAnalysisNotebookCells(buildContext(), buildAnalysis());
    // Same base shape as the first test above - explicit here so this
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

    expect(cells).toHaveLength(9);
    const executionPlanCell = findCell(cells, "## Execution plan");
    expect(executionPlanCell.kind).toBe(NotebookCellKind.Markup);
    expect(executionPlanCell.value).toContain("```text");
    expect(executionPlanCell.value).toContain("Seq Scan");
    expect(executionPlanCell.value).toContain("### Tables referenced by this plan");
    expect(executionPlanCell.value).toContain("| orders |");
    expect(findCell(cells, "### Findings").value).toContain("### Findings");
  });

  it("still adds the execution plan cell for table mappings alone, with no normalizedPlan", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({ planTableMappings: [{ planNodeId: "n0", tableName: "orders" }] }),
      buildAnalysis()
    );
    expect(cells).toHaveLength(9);
    const executionPlanCell = findCell(cells, "## Execution plan");
    expect(executionPlanCell.value).not.toContain("```text");
    expect(executionPlanCell.value).toContain("### Tables referenced by this plan");
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
    const executionPlanCell = findCell(cells, "## Execution plan");
    expect(executionPlanCell.value).toContain("| Table | Index | Est. rows | Actual rows | Actual/est. ratio | Access fraction | Filter pass rate | Columns used |");
    expect(executionPlanCell.value).toContain("| orders | - | 50 | 37 | 0.74x | - | - |");
  });

  it("keeps a very small actual/estimated ratio visible instead of rounding it to 0.00x", () => {
    const cells = buildAiAnalysisNotebookCells(
      buildContext({
        planTableMappings: [
          { planNodeId: "n0", tableName: "customers", estimatedRows: 30000, actualRows: 1, rowEstimateRatio: 1 / 30000 },
        ],
      }),
      buildAnalysis()
    );
    expect(findCell(cells, "## Execution plan").value).toContain("0.0000333x");
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
    const executionPlanCell = findCell(cells, "## Execution plan");
    expect(executionPlanCell.value).toContain("### Actual execution plan (EXPLAIN ANALYZE)");
    expect(executionPlanCell.value).toContain("```actual-plan");
    expect(executionPlanCell.value).toContain("actual time=0.05..1.2 rows=5 loops=1");
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
    expect(cells).toHaveLength(8);
    const executionPlanCell = findCell(cells, "## Execution plan");
    expect(executionPlanCell.value).toContain("### Actual execution plan (EXPLAIN ANALYZE)");
    expect(executionPlanCell.value).not.toContain("### Tables referenced by this plan");
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
