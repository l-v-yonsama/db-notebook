import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCellData, NotebookCellKind, Uri, ViewColumn, workspace } from "vscode";
import { openNotebookFile, writeNotebookFile } from "../notebook/notebookFileUtil";
import type {
  PerformanceTuningAiAnalysisResult,
  PerformanceTuningAiEvidenceRef,
  PerformanceTuningAiFinding,
  PerformanceTuningAiRecommendation,
} from "../shared/PerformanceTuningAiAnalysis";
import { createDirectory, existsUri } from "./fsUtil";

// Step 10 (misc/design/performance-tuning-structured-ai-analysis-plan.ja.md
// §8): always creates a new Notebook under a fixed
// reports/performance-tuning/ folder (no save dialog, no appending to an
// existing Notebook - decided with the user rather than left as an open
// question, see the design doc's §16.1). Cell construction (pure) is kept
// separate from the write/open I/O below it so it stays unit-testable
// without mocking vscode.workspace.fs.
const REPORTS_SUBPATH = ["reports", "performance-tuning"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimestamp(now: Date): string {
  return (
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  );
}

/** Exported for tests; also usable if a caller ever wants to preview the target name. */
export function buildAiAnalysisNotebookFilename(databaseName: string, now: Date = new Date()): string {
  const safeDb = databaseName.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "db";
  return `perf-tuning-analysis-${safeDb}-${formatTimestamp(now)}.dbn`;
}

function markupCell(value: string): NotebookCellData {
  return new NotebookCellData(NotebookCellKind.Markup, value, "markdown");
}

function jsonCodeCell(value: string): NotebookCellData {
  return new NotebookCellData(NotebookCellKind.Code, value, "json");
}

function evidenceLine(evidence: PerformanceTuningAiEvidenceRef | undefined): string {
  if (!evidence) {
    return "-";
  }
  const parts: string[] = [];
  const tableRef = [evidence.schemaName, evidence.tableName].filter(Boolean).join(".");
  if (tableRef) {
    parts.push(`Table: ${tableRef}`);
  }
  if (evidence.indexName) {
    parts.push(`Index: ${evidence.indexName}`);
  }
  if (evidence.planNodeId) {
    parts.push(`Plan node: ${evidence.planNodeId}`);
  }
  if (evidence.diagnosticCode) {
    parts.push(`Diagnostic: ${evidence.diagnosticCode}`);
  }
  return parts.length > 0 ? parts.join(" / ") : "-";
}

// Markdown table cells render literal pipe/newline characters badly - none of
// these fields are expected to contain them in practice, but a defensive
// escape keeps a stray literal from breaking the table layout instead of
// silently dropping content.
function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br/>");
}

function buildOverviewMarkdown(
  context: PerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult
): string {
  const lines: string[] = [];
  lines.push("# Performance Tuning AI Analysis");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(
    `| Database | ${context.database.vendor}${
      context.database.version ? ` ${context.database.version}` : ""
    } / ${context.database.databaseName}${
      context.database.schemaName ? `.${context.database.schemaName}` : ""
    } |`
  );
  lines.push(`| Collected at | ${context.collection.collectedAt} |`);
  lines.push(`| Collection status | ${context.collection.status} |`);
  lines.push(
    `| AI model | ${analysis.model.name ?? analysis.model.family} (${analysis.model.vendor}) |`
  );
  lines.push(`| Analyzed at | ${analysis.generatedAt} |`);
  lines.push(`| Confidence | ${analysis.confidence} |`);
  lines.push("");
  lines.push("## Target SQL");
  lines.push("");
  lines.push("```sql");
  lines.push(context.statement.sql);
  lines.push("```");
  return lines.join("\n");
}

function findingsTable(findings: PerformanceTuningAiFinding[]): string[] {
  if (findings.length === 0) {
    return ["_No findings were reported._"];
  }
  const lines = ["| Severity | Title | Detail | Evidence |", "|---|---|---|---|"];
  for (const f of findings) {
    lines.push(
      `| ${f.severity} | ${escapeMdCell(f.title)} | ${escapeMdCell(f.detail)} | ${evidenceLine(f.evidence)} |`
    );
  }
  return lines;
}

function recommendationsTable(recommendations: PerformanceTuningAiRecommendation[]): string[] {
  if (recommendations.length === 0) {
    return ["_No recommendations were reported._"];
  }
  const lines = ["| Risk | Title | Detail | Rationale | Suggested SQL | Evidence |", "|---|---|---|---|---|---|"];
  for (const r of recommendations) {
    lines.push(
      `| ${r.riskLevel ?? "-"} | ${escapeMdCell(r.title)} | ${escapeMdCell(r.detail)} | ${escapeMdCell(
        r.rationale
      )} | ${r.suggestedSql ? "`" + escapeMdCell(r.suggestedSql) + "`" : "-"} | ${evidenceLine(r.evidence)} |`
    );
  }
  return lines;
}

function buildAnalysisMarkdown(analysis: PerformanceTuningAiAnalysisResult): string {
  const lines: string[] = [];
  lines.push("## Summary");
  lines.push("");
  lines.push(analysis.summary);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push(...findingsTable(analysis.findings));
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  lines.push(...recommendationsTable(analysis.recommendations));
  lines.push("");
  lines.push(
    `_Recommendations are AI-generated suggestions based on this one context snapshot - they are not applied ` +
      `automatically and must be reviewed and run manually._`
  );
  lines.push("");
  lines.push("## Missing context");
  lines.push("");
  if (analysis.missingContext.length === 0) {
    lines.push("_None reported._");
  } else {
    for (const m of analysis.missingContext) {
      lines.push(`- ${m}`);
    }
  }
  return lines.join("\n");
}

/** Pure cell-construction step (§8.2) - kept separate from the write/open I/O below for unit testing. */
export function buildAiAnalysisNotebookCells(
  context: PerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult
): NotebookCellData[] {
  return [
    markupCell(buildOverviewMarkdown(context, analysis)),
    markupCell(buildAnalysisMarkdown(analysis)),
    jsonCodeCell(JSON.stringify(context, null, 2)),
    jsonCodeCell(JSON.stringify(analysis, null, 2)),
  ];
}

export type SaveAiAnalysisAsNotebookResult =
  | { ok: true; relativePath: string; uri: Uri }
  | { ok: false; message: string };

/**
 * Writes and opens a new Notebook under `<workspace root>/reports/performance-tuning/`
 * (auto-created if missing), containing the SQL/context overview, the AI
 * analysis, and both raw JSON payloads as evidence (§8). Never appends to an
 * existing Notebook and never prompts a save dialog - both decided with the
 * user (design doc §16.1).
 */
export async function saveAiAnalysisAsNotebook(
  context: PerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult
): Promise<SaveAiAnalysisAsNotebookResult> {
  const wsFolder = workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    return {
      ok: false,
      message:
        "No workspace folder is open, so the AI analysis notebook cannot be saved. Open a workspace folder and try again.",
    };
  }

  const dirUri = Uri.joinPath(wsFolder.uri, ...REPORTS_SUBPATH);
  let filename = buildAiAnalysisNotebookFilename(context.database.databaseName);
  let targetUri = Uri.joinPath(dirUri, filename);

  await createDirectory(dirUri);
  // Timestamp resolution is seconds, so a collision is extremely unlikely -
  // guarded anyway so a same-second double-click never silently clobbers a
  // prior save.
  if (await existsUri(targetUri)) {
    filename = filename.replace(/\.dbn$/, `-${Date.now()}.dbn`);
    targetUri = Uri.joinPath(dirUri, filename);
  }

  const cells = buildAiAnalysisNotebookCells(context, analysis);
  await writeNotebookFile(cells, targetUri);
  // ViewColumn.Two, not Beside, matching cfnDiagramPreviewNotebook.ts's
  // established convention for "open a generated Notebook next to whatever
  // the user already has open" - Beside is relative to the *active* editor,
  // which may not be the Preview Panel the user pressed Save from.
  await openNotebookFile(targetUri, { viewColumn: ViewColumn.Two });

  return { ok: true, relativePath: [...REPORTS_SUBPATH, filename].join("/"), uri: targetUri };
}
