import {
  createPerformanceQueryDiagram,
  type PerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCellData, NotebookCellKind, Uri, ViewColumn, workspace } from "vscode";
import { openNotebookFile, writeNotebookFile } from "../notebook/notebookFileUtil";
import type {
  PerformanceTuningAiAnalysisResult,
  PerformanceTuningAiEvidenceRef,
  PerformanceTuningAiFinding,
  PerformanceTuningAiRecommendation,
} from "../shared/PerformanceTuningAiAnalysis";
import { actualExecutionEvidenceSource, hasActualExecutionEvidence } from "../shared/PerformanceTuningActualEvidence";
import type { PerformanceTuningHumanSummary } from "../shared/PerformanceTuningHumanSummary";
import { createDirectory, existsUri } from "./fsUtil";
import { buildAiAnalysisPrompt } from "./performanceTuningAiPrompt";
import { buildPerformanceTuningDiagnosticGroups } from "./performanceTuningDiagnosticFormatter";
import { buildPerformanceTuningHumanSummary } from "./performanceTuningHumanSummary";
import { buildPlanTableMappingRows, formatPlanTree } from "./performanceTuningPlanFormatter";

// Report cells are built separately from notebook I/O so their contents stay
// unit-testable without VS Code filesystem mocks.
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

// cellLabel (CellLabelProvider in statusBarProviders.ts) is what keeps these
// two JSON cells from showing up as an unlabeled "json"+"Not executed" pair
// in the notebook's TOC/HTML report - see getTocInfoHtml() in htmlGenerator.ts.
function jsonCodeCell(value: string, cellLabel: string): NotebookCellData {
  const cell = new NotebookCellData(NotebookCellKind.Code, value, "json");
  cell.metadata = { cellLabel };
  return cell;
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

function formatRatio(value: number | undefined): string {
  if (value === undefined) {
    return "-";
  }
  const text = value !== 0 && (Math.abs(value) < 0.01 || Math.abs(value) >= 1_000)
    ? value.toPrecision(3)
    : value.toFixed(2);
  return `${text}x`;
}

function formatFractionAsPercent(value: number | undefined): string {
  if (value === undefined) {
    return "-";
  }
  const percent = value * 100;
  const text = percent !== 0 && Math.abs(percent) < 0.01 ? percent.toPrecision(3) : percent.toFixed(2);
  return `${text}%`;
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US");
}

function buildOverviewMarkdown(
  context: PerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult
): string {
  const lines: string[] = [];
  lines.push("# Performance Tuning AI Analysis");
  lines.push("");
  lines.push("| Item | Detail |");
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
  lines.push(
    `| AI input detail | ${analysis.request?.contextDetail === "compact" ? "Compact (raw vendor artifacts omitted for model limit)" : "Full"} |`
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

export function buildPerformanceSnapshotMarkdown(summary: PerformanceTuningHumanSummary): string {
  const lines = [
    "## Performance snapshot",
    "",
    "_Deterministic summaries of collected database facts; these are separate from the AI analysis._",
    "",
    "| Statement | Evidence | Scope | Collection |",
    "|---|---|---|---|",
    `| ${summary.profile.statementKind} | ${summary.profile.evidence === "actual" ? "Actual measured" : "Estimate only"} | ${summary.profile.tableCount} ${summary.profile.tableCount === 1 ? "table" : "tables"} | ${summary.profile.collectionStatus} |`,
    "",
  ];
  if (summary.profile.tableRefs.length > 0) {
    lines.push(`**Query tables:** ${summary.profile.tableRefs.map(escapeMdCell).join(" · ")}`, "");
  }

  lines.push(
    "### Observed signals",
    "",
    "| Level | Signal | Table | Observation | Raw data |",
    "|---|---|---|---|---|",
  );
  summary.signals.forEach((signal) => {
    lines.push(
      `| ${signal.level} | ${escapeMdCell(signal.title)} | ${signal.tableRef ? escapeMdCell(signal.tableRef) : "-"} | ${escapeMdCell(signal.summary)} | ${escapeMdCell(signal.rawDataPath)} |`,
    );
  });

  if (summary.rowFlows.length > 0) {
    lines.push(
      "",
      "### Table row flow",
      "",
      "| Table | Table rows | Accessed | Local filter output | Plan output | Access fraction | Filter pass rate | Raw data |",
      "|---|---|---|---|---|---|---|---|",
    );
    const isDml = ["INSERT", "UPDATE", "DELETE"].includes(summary.profile.statementKind);
    summary.rowFlows.forEach((flow) => {
      lines.push(
        `| ${escapeMdCell(flow.tableRef)} | ${formatNumber(flow.totalRows)}${flow.totalRows !== undefined && flow.totalRowsEstimated ? " (estimated)" : ""} | ${isDml ? "Not measured (DML)" : formatNumber(flow.accessedRows)} | ${isDml ? "Not measured (DML)" : formatNumber(flow.filterOutputRows)} | ${isDml ? "Not measured (DML)" : formatNumber(flow.planOutputRows)} | ${isDml ? "Not measured (DML)" : formatFractionAsPercent(flow.accessFraction)} | ${isDml ? "Not measured (DML)" : formatFractionAsPercent(flow.filterPassRate)} | ${escapeMdCell(flow.rawDataPath)} |`,
      );
    });
  }
  return lines.join("\n");
}

function buildQueryStructureMarkdown(context: PerformanceTuningContext): string | undefined {
  const diagram = createPerformanceQueryDiagram(context);
  if (!diagram) {
    return undefined;
  }
  const lines = [
    "## Query structure",
    "",
    "_Only tables and columns relevant to this SQL are shown. Relationship lines are drawn only from unambiguous declared foreign keys._",
    "",
    "```mermaid",
    diagram.mermaid,
    "```",
  ];
  if (diagram.relevantIndexes.length > 0) {
    lines.push(
      "",
      "### Indexes relevant to this SQL",
      "",
      "| Table | Index | Key columns | Included columns | Query relevance |",
      "|---|---|---|---|---|",
    );
    diagram.relevantIndexes.forEach((index) => {
      const tableRef = [index.schemaName, index.tableName].filter(Boolean).join(".") +
        (index.alias ? ` (alias ${index.alias})` : "");
      const indexKind = index.primary ? "PRIMARY" : index.unique ? "UNIQUE" : undefined;
      const indexName = `${escapeMdCell(index.indexName)}${indexKind ? ` (${indexKind})` : ""}`;
      lines.push(
        `| ${escapeMdCell(tableRef)} | ${indexName} | ${escapeMdCell(index.columns.join(", "))} | ${
          index.includedColumns?.length ? escapeMdCell(index.includedColumns.join(", ")) : "-"
        } | ${escapeMdCell(index.relevance.join("; "))} |`,
      );
    });
  }
  if (diagram.warnings.length > 0) {
    lines.push("", "### Diagram notes", "", ...diagram.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}

function diagnosticGroupsMarkdown(
  groups: ReturnType<typeof buildPerformanceTuningDiagnosticGroups>,
): string[] {
  const lines: string[] = [];
  groups.forEach((group) => {
    lines.push(`### ${group.title}`, "", group.summary, "");
    if (group.suggestedAction) {
      lines.push(`**Suggested action:** ${group.suggestedAction}`, "");
    }
    lines.push("| Node | Operation | Object | Table | Detail |", "|---|---|---|---|---|");
    group.details.forEach((detail) => {
      const tableRef = [detail.schemaName, detail.tableName].filter(Boolean).join(".");
      lines.push(
        `| ${escapeMdCell(detail.nodeId ?? "-")} | ${escapeMdCell(detail.operation ?? "-")} | ${
          escapeMdCell(detail.objectName ?? "-")
        } | ${escapeMdCell(tableRef || "-")} | ${escapeMdCell(detail.technicalMessage)} |`,
      );
    });
    lines.push("");
  });
  return lines;
}

function buildDiagnosticSections(context: PerformanceTuningContext): {
  collectionIssues?: string;
  information?: string;
} {
  const groups = buildPerformanceTuningDiagnosticGroups(
    context.collection.diagnostics,
    context.collection.unavailableSections,
  );
  const issues = groups.filter((group) => group.severity === "warning");
  const information = groups.filter((group) => group.severity === "info");

  return {
    collectionIssues: issues.length > 0
      ? ["## Collection issues", "", ...diagnosticGroupsMarkdown(issues)].join("\n")
      : undefined,
    information: information.length > 0
      ? [
          "## Information",
          "",
          "_The items below describe execution-plan characteristics. On their own, they don't indicate a confirmed performance problem — see each item's technical details._",
          "",
          ...diagnosticGroupsMarkdown(information),
        ].join("\n")
      : undefined,
  };
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
  const lines = [
    "| Risk | Title | Detail | Rationale | Suggested SQL | Possible duplicate | Evidence |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of recommendations) {
    lines.push(
      `| ${r.riskLevel ?? "-"} | ${escapeMdCell(r.title)} | ${escapeMdCell(r.detail)} | ${escapeMdCell(
        r.rationale
      )} | ${r.suggestedSql ? "`" + escapeMdCell(r.suggestedSql) + "`" : "-"} | ${
        // Host-computed (findPossibleDuplicateIndex() in
        // PerformanceTuningPreviewPanel.ts), never AI-authored - see
        // PerformanceTuningAiRecommendation.possibleDuplicateOfIndex's own
        // doc comment.
        r.possibleDuplicateOfIndex ? "`" + escapeMdCell(r.possibleDuplicateOfIndex) + "`" : "-"
      } | ${evidenceLine(r.evidence)} |`
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
  lines.push("### Findings");
  lines.push("");
  lines.push(...findingsTable(analysis.findings));
  lines.push("");
  lines.push("### Recommendations");
  lines.push("");
  lines.push(...recommendationsTable(analysis.recommendations));
  lines.push("");
  lines.push(
    `_Recommendations are AI-generated suggestions based on this one context snapshot - they are not applied ` +
      `automatically and must be reviewed and run manually._`
  );
  lines.push("");
  lines.push("### Missing context");
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

// planTableMappings is a flat array (one row per table/index touched), so
// unlike the plan tree below it genuinely suits a markdown table - see
// performanceTuningPlanFormatter.ts's top comment.
function planTableMappingsTable(rows: ReturnType<typeof buildPlanTableMappingRows>): string[] {
  const lines = [
    "| Table | Index | Est. rows | Actual rows | Actual/est. ratio | Access fraction | Filter pass rate | Columns used |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    const ratio = formatRatio(row.rowEstimateRatio);
    const accessFraction = formatFractionAsPercent(row.tableAccessFraction);
    const filterPassRate = formatFractionAsPercent(row.predicateFilterSelectivity);
    lines.push(
      `| ${escapeMdCell(row.table)} | ${row.index ? escapeMdCell(row.index) : "-"} | ${
        row.estimatedRows ?? "-"
      } | ${row.actualRows ?? "-"} | ${ratio} | ${accessFraction} | ${filterPassRate} | ${row.columnsUsed ? escapeMdCell(row.columnsUsed) : "-"} |`
    );
  }
  return lines;
}

// 2026-08-19 follow-up: executionPlan.normalizedPlan is a tree, so it's
// rendered as an EXPLAIN-style indented text block (a table would lose the
// parent-child structure that's the whole point of an execution plan);
// planTableMappings is genuinely flat, so that one becomes a table.
// actualPlan is a third, independent piece of database-native runtime
// evidence. It gets its own fenced block rather than being merged into the
// normalized estimate tree or the table-mapping rows.
function buildExecutionPlanMarkdown(context: PerformanceTuningContext): string | undefined {
  const planTreeText = context.executionPlan.normalizedPlan
    ? formatPlanTree(context.executionPlan.normalizedPlan)
    : undefined;
  const rows = buildPlanTableMappingRows(context.planTableMappings);
  const actualPlan = context.executionPlan.actualPlan;
  const hasActualEvidence = hasActualExecutionEvidence(context);
  const actualEvidenceSource = actualExecutionEvidenceSource(context);
  if (!planTreeText && rows.length === 0 && !actualPlan) {
    return undefined;
  }

  const lines: string[] = ["## Execution plan", ""];
  if (actualPlan) {
    lines.push(
      `_Runtime evidence from ${actualPlan.source} is shown first. The estimated topology below is retained only for structured table/predicate metadata and comparison._`,
      "",
      `### Actual execution plan (${actualPlan.source})`,
      "",
      "```actual-plan",
      actualPlan.content,
      "```",
      "",
    );
  }
  if (planTreeText) {
    lines.push(
      actualPlan
        ? "### Estimated plan topology"
        : hasActualEvidence
          ? `### Actual execution plan (${actualEvidenceSource})`
          : "### Execution plan topology",
      "",
      "```text",
      planTreeText,
      "```",
      "",
    );
  }
  if (rows.length > 0) {
    lines.push("### Table metrics", "", ...planTableMappingsTable(rows), "");
  }
  return lines.join("\n");
}

// One shared lead-in for both JSON cells below (rather than one per cell) -
// cellLabel alone (CellLabelProvider) makes the TOC/HTML report readable,
// but doesn't explain *why* the raw data is there when reading the notebook
// itself top to bottom.
function buildJsonAppendixMarkdown(): string {
  return [
    "## Appendix: Raw data",
    "",
    "The sections below are supplementary reference material, not part of the analysis itself: the exact " +
      "context sent to the AI (**Full context JSON**) and the AI's raw response (**AI analysis JSON**). They " +
      "contain the detailed evidence behind the summary above. **AI request messages** records the exact " +
      "assistant/user prompt and model identity used for this analysis, so the request can be repeated or " +
      "compared with another model.",
  ].join("\n");
}

function buildAiRequestMessagesJson(
  context: PerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult
): string {
  const request = analysis.request;
  const prompt = buildAiAnalysisPrompt(context, {
    translateResponse: request?.translateResponse,
    language: request?.language,
    contextDetail: request?.contextDetail,
  });
  return JSON.stringify(
    {
      promptFormatVersion: request?.promptFormatVersion ?? 1,
      model: analysis.model,
      messages: [
        { role: "assistant", content: prompt.assistant },
        { role: "user", content: prompt.user },
      ],
    },
    null,
    2
  );
}

/** Pure cell-construction step (§8.2) - kept separate from the write/open I/O below for unit testing. */
export function buildAiAnalysisNotebookCells(
  context: PerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult
): NotebookCellData[] {
  const cells: NotebookCellData[] = [
    markupCell(buildOverviewMarkdown(context, analysis)),
    markupCell(buildPerformanceSnapshotMarkdown(buildPerformanceTuningHumanSummary(context))),
  ];

  const diagnosticSections = buildDiagnosticSections(context);
  if (diagnosticSections.collectionIssues) {
    cells.push(markupCell(diagnosticSections.collectionIssues));
  }
  if (diagnosticSections.information) {
    cells.push(markupCell(diagnosticSections.information));
  }

  const queryStructureMarkdown = buildQueryStructureMarkdown(context);
  if (queryStructureMarkdown) {
    cells.push(markupCell(queryStructureMarkdown));
  }

  // Evidence precedes the AI interpretation in both the Preview and saved
  // report: SQL/snapshot/diagnostics → structure → execution plan → AI.
  const executionPlanMarkdown = buildExecutionPlanMarkdown(context);
  if (executionPlanMarkdown) {
    cells.push(markupCell(executionPlanMarkdown));
  }

  cells.push(
    markupCell(buildAnalysisMarkdown(analysis)),
    markupCell(buildJsonAppendixMarkdown()),
    jsonCodeCell(JSON.stringify(context, null, 2), "Full context JSON"),
    jsonCodeCell(buildAiRequestMessagesJson(context, analysis), "AI request messages"),
    jsonCodeCell(JSON.stringify(analysis, null, 2), "AI analysis JSON")
  );
  return cells;
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
