import type {
  DynamoDbCapacityBreakdown,
  DynamoDbPerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { validateDynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCellData, Uri, ViewColumn, workspace } from "vscode";
import { openNotebookFile, writeNotebookFile } from "../notebook/notebookFileUtil";
import type { PerformanceTuningAiAnalysisResult } from "../shared/PerformanceTuningAiAnalysis";
import type { DynamoDbPerformanceTuningHumanSummary } from "../shared/DynamoDbPerformanceTuningHumanSummary";
import { buildDynamoDbPerformanceTuningDiagnosticGroups } from "./dynamoDbPerformanceTuningDiagnosticFormatter";
import { buildDynamoDbPerformanceTuningHumanSummary } from "./dynamoDbPerformanceTuningHumanSummary";
import { buildDynamoDbAiAnalysisPrompt } from "./dynamoDbPerformanceTuningAiPrompt";
import { createDirectory, existsUri } from "./fsUtil";
import {
  buildAiAnalysisNotebookFilename,
  buildAnalysisMarkdown,
  buildJsonAppendixMarkdown,
  diagnosticGroupsMarkdown,
  escapeMdCell,
  evidenceLine,
  formatNumber,
  jsonCodeCell,
  markupCell,
  type SaveAiAnalysisAsNotebookResult,
} from "./performanceTuningAiNotebook";

// DynamoDB counterpart of performanceTuningAiNotebook.ts (design doc §13).
// Reuses that file's engine-agnostic helpers (NotebookCellData construction,
// diagnostic-group/analysis markdown, the JSON appendix framing) rather than
// duplicating them - see each import's origin for why it's safe to share.
// Cell order matches §13 exactly: Overview/Target (+ the static query-flow
// diagram, folded in here rather than its own cell since - unlike RDB's
// per-query ER diagram - it is the same illustrative shape for every
// DynamoDB statement) → Performance snapshot → Collection issues →
// Access pattern → Table/index definition → Observed request → CloudWatch
// metrics → AI Analysis → Appendix: Raw metrics → Full context JSON/AI
// request messages/AI analysis JSON.

const QUERY_FLOW_MERMAID = `flowchart LR
  Request["PartiQL SELECT / Query"] --> Target["Table or Index"]
  Target --> Key["Partition/Sort key condition"]
  Key --> Filter["Post-read filter"]
  Filter --> Result["Returned items"]`;

function formatCapacity(c: DynamoDbCapacityBreakdown): string {
  const parts: string[] = [];
  if (c.capacityUnits !== undefined) {
    parts.push(`${c.capacityUnits} total`);
  }
  if (c.readCapacityUnits !== undefined) {
    parts.push(`${c.readCapacityUnits} read`);
  }
  if (c.writeCapacityUnits !== undefined) {
    parts.push(`${c.writeCapacityUnits} write`);
  }
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function targetRef(context: DynamoDbPerformanceTuningContext): string {
  const { tableName, indexName } = context.service;
  if (!indexName) {
    return tableName;
  }
  return `${tableName} (${context.accessPattern.indexType ?? "index"} ${indexName})`;
}

function buildOverviewMarkdown(
  context: DynamoDbPerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult,
): string {
  const lines: string[] = [];
  lines.push("# DynamoDB Performance Tuning AI Analysis");
  lines.push("");
  lines.push("| Item | Detail |");
  lines.push("|---|---|");
  lines.push(`| Target | ${escapeMdCell(targetRef(context))} |`);
  if (context.service.region) {
    lines.push(`| Region | ${context.service.region} |`);
  }
  lines.push(`| Collected at | ${context.collection.collectedAt} |`);
  lines.push(`| Collection status | ${context.collection.status} |`);
  lines.push(`| AI model | ${analysis.model.name ?? analysis.model.family} (${analysis.model.vendor}) |`);
  lines.push(
    `| AI input detail | ${analysis.request?.contextDetail === "compact" ? "Compact" : "Full"} |`,
  );
  lines.push(`| Analyzed at | ${analysis.generatedAt} |`);
  lines.push(`| Confidence | ${analysis.confidence} |`);
  lines.push("");
  lines.push("## Target request");
  lines.push("");
  if (context.statement.text) {
    lines.push("```sql", context.statement.text, "```");
  } else {
    lines.push(`Native Query on ${escapeMdCell(targetRef(context))}. See Access pattern below for the resolved key condition/filter/projection.`);
  }
  lines.push("");
  lines.push("## Query flow");
  lines.push("");
  lines.push(
    "_DynamoDB has no query optimizer or execution plan - unlike RDB, this is a fixed illustration of how every DynamoDB read is shaped, not a diagram specific to this statement. See Access pattern below for this statement's actual key condition/filter._",
  );
  lines.push("");
  lines.push("```mermaid", QUERY_FLOW_MERMAID, "```");
  return lines.join("\n");
}

export function buildDynamoDbPerformanceSnapshotMarkdown(summary: DynamoDbPerformanceTuningHumanSummary): string {
  const lines = [
    "## Performance snapshot",
    "",
    "_Deterministic summaries of collected DynamoDB facts; these are separate from the AI analysis._",
    "",
    "| Operation | Access path | Target | Evidence | Collection |",
    "|---|---|---|---|---|",
    `| ${summary.profile.operation} | ${summary.profile.accessPath}${summary.profile.confidence === "unknown" ? " (unresolved)" : ""} | ${escapeMdCell(summary.profile.targetRef)} | ${summary.profile.evidence} | ${summary.profile.collectionStatus} |`,
    "",
    "### Observed signals",
    "",
    "| Level | Signal | Observation | Raw data |",
    "|---|---|---|---|",
  ];
  summary.signals.forEach((signal) => {
    lines.push(
      `| ${signal.level} | ${escapeMdCell(signal.title)} | ${escapeMdCell(signal.summary)} | ${escapeMdCell(signal.rawDataPath)} |`,
    );
  });
  return lines.join("\n");
}

function buildDiagnosticSections(context: DynamoDbPerformanceTuningContext): {
  collectionIssues?: string;
  information?: string;
} {
  const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
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
          "_The items below describe access-pattern/collection characteristics. On their own, they don't indicate a confirmed performance problem — see each item's technical details._",
          "",
          ...diagnosticGroupsMarkdown(information),
        ].join("\n")
      : undefined,
  };
}

export function buildAccessPatternMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const { accessPattern } = context;
  const lines = ["## Access pattern", ""];
  if (accessPattern.confidence === "unknown") {
    lines.push(
      "_This statement's access path could not be safely classified. Treat the read cost as unknown._",
      "",
    );
  }
  lines.push("| Field | Value |", "|---|---|");
  lines.push(`| Operation | ${accessPattern.operation} |`);
  lines.push(`| Access path | ${accessPattern.accessPath} |`);
  lines.push(
    `| Partition key | ${
      accessPattern.partitionKey
        ? `${accessPattern.partitionKey.attributeName}${
            accessPattern.partitionKey.conditionPresent
              ? ` ${accessPattern.partitionKey.operator ?? "="}`
              : " (no condition)"
          }`
        : "-"
    } |`,
  );
  if (accessPattern.sortKey) {
    lines.push(
      `| Sort key | ${accessPattern.sortKey.attributeName}${
        accessPattern.sortKey.conditionPresent ? ` ${accessPattern.sortKey.operator ?? ""}` : " (no condition)"
      } |`,
    );
  }
  lines.push(
    `| Post-read filter | ${
      accessPattern.postReadFilter.present
        ? escapeMdCell(accessPattern.postReadFilter.attributes.join(", ") || "present (attributes not resolved)")
        : "None"
    } |`,
  );
  lines.push(
    `| Projection | ${
      accessPattern.projection.allAttributes
        ? "All attributes"
        : escapeMdCell(accessPattern.projection.attributes.join(", ") || "Specific (not resolved)")
    } |`,
  );
  lines.push(`| Consistency | ${accessPattern.consistentRead} |`);
  if (accessPattern.limit !== undefined) {
    lines.push(`| Limit | ${accessPattern.limit} |`);
  }
  if (accessPattern.scanForward !== undefined) {
    lines.push(`| Scan direction | ${accessPattern.scanForward ? "Forward" : "Backward"} |`);
  }
  return lines.join("\n");
}

export function buildTableDefinitionMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const { table } = context;
  const lines = ["## Table and index definition", "", "| Field | Value |", "|---|---|"];
  lines.push(`| Billing mode | ${table.billingMode} |`);
  lines.push(
    `| Partition key | ${table.keySchema.partitionKey.attributeName} (${table.keySchema.partitionKey.attributeType}) |`,
  );
  if (table.keySchema.sortKey) {
    lines.push(`| Sort key | ${table.keySchema.sortKey.attributeName} (${table.keySchema.sortKey.attributeType}) |`);
  }
  if (table.itemCount) {
    lines.push(`| Item count | ${formatNumber(table.itemCount.value)} (approximate) |`);
  }
  if (table.tableSizeBytes) {
    lines.push(`| Table size | ${formatNumber(table.tableSizeBytes.value)} bytes (approximate) |`);
  }
  if (table.ttl) {
    lines.push(`| TTL | ${table.ttl.status}${table.ttl.attributeName ? ` (${table.ttl.attributeName})` : ""} |`);
  }

  const allIndexes = [...table.localSecondaryIndexes, ...table.globalSecondaryIndexes];
  if (allIndexes.length > 0) {
    lines.push(
      "",
      "### Indexes",
      "",
      "| Name | Type | Partition key | Sort key | Projection |",
      "|---|---|---|---|---|",
    );
    allIndexes.forEach((idx) => {
      lines.push(
        `| ${escapeMdCell(idx.indexName)} | ${idx.indexType} | ${idx.keySchema.partitionKey.attributeName} | ${idx.keySchema.sortKey?.attributeName ?? "-"} | ${idx.projection.projectionType}${idx.projection.nonKeyAttributes && idx.projection.nonKeyAttributes.length > 0 ? ` (${escapeMdCell(idx.projection.nonKeyAttributes.join(", "))})` : ""} |`,
      );
    });
  }

  if (table.contributorInsights.length > 0) {
    lines.push(
      "",
      `_Contributor Insights: ${escapeMdCell(
        table.contributorInsights.map((ci) => `${ci.indexName ?? "table"}: ${ci.status}`).join(", "),
      )}_`,
    );
  }
  return lines.join("\n");
}

export function buildObservedRequestMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const lines = ["## Observed request", ""];
  const observation = context.observation;
  if (!observation) {
    lines.push("_No read has been observed for this exact statement yet._");
    return lines.join("\n");
  }
  lines.push("| Field | Value |", "|---|---|");
  lines.push(`| Source | ${observation.source} |`);
  if (observation.observedAt) {
    lines.push(`| Observed at | ${observation.observedAt} |`);
  }
  lines.push(`| Returned items | ${observation.returnedItemCount ?? "-"} |`);
  if (observation.scannedItemCount !== undefined) {
    lines.push(`| Scanned items | ${observation.scannedItemCount} |`);
  }
  if (observation.filterPassRate !== undefined) {
    lines.push(`| Filter pass rate | ${(observation.filterPassRate * 100).toFixed(2)}% |`);
  }
  if (observation.consumedCapacity) {
    lines.push(`| Consumed Capacity | ${formatCapacity(observation.consumedCapacity)} |`);
  }
  lines.push(`| Request / retry count | ${observation.requestCount ?? "-"} / ${observation.retryCount ?? "-"} |`);
  if (observation.bounded) {
    lines.push(
      "",
      `_${observation.boundDescription ?? "This observation is bounded and may not reflect the statement's full result."}_`,
    );
  }
  return lines.join("\n");
}

function seriesScopeLabel(series: NonNullable<DynamoDbPerformanceTuningContext["cloudWatch"]>["series"][number]): string {
  return `${series.scope}${series.indexName ? ` (${series.indexName})` : ""}${series.operation ? ` / ${series.operation}` : ""}`;
}

export function buildCloudWatchMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const lines = ["## CloudWatch metrics", ""];
  const cw = context.cloudWatch;
  if (!cw) {
    lines.push("_CloudWatch metrics were not collected._");
    return lines.join("\n");
  }
  lines.push(
    `Window: ${cw.window.startTime} – ${cw.window.endTime} (period ${cw.window.periodSeconds}s). Table/index/operation-level activity over that window, not only this statement.`,
    "",
  );
  if (cw.series.length === 0) {
    lines.push("_No CloudWatch series were collected._");
    return lines.join("\n");
  }
  lines.push("| Metric | Scope | Statistic | Latest | Max |", "|---|---|---|---|---|");
  cw.series.forEach((s) => {
    const scope = escapeMdCell(seriesScopeLabel(s));
    if (s.noData) {
      lines.push(`| ${escapeMdCell(s.metricName)} | ${scope} | ${s.statistic} | no data | no data |`);
      return;
    }
    const latest = s.values.length > 0 ? s.values[s.values.length - 1] : "-";
    const max = s.values.length > 0 ? Math.max(...s.values) : "-";
    lines.push(`| ${escapeMdCell(s.metricName)} | ${scope} | ${s.statistic} | ${latest} | ${max} |`);
  });
  return lines.join("\n");
}

// "Appendix: Raw metrics" (§13 item 9) - the full per-datapoint series
// behind the summarized (latest/max only) table above, kept as its own,
// separate, later cell so the main CloudWatch section stays short.
function buildRawMetricsAppendixMarkdown(context: DynamoDbPerformanceTuningContext): string | undefined {
  const cw = context.cloudWatch;
  if (!cw || cw.series.length === 0) {
    return undefined;
  }
  const lines = ["## Appendix: Raw metrics", "", "_Full CloudWatch datapoints behind the summarized table above._", ""];
  cw.series.forEach((s) => {
    lines.push(`### ${escapeMdCell(s.metricName)} (${s.statistic}) - ${escapeMdCell(seriesScopeLabel(s))}`, "");
    if (s.noData || s.timestamps.length === 0) {
      lines.push("_No datapoints for this window._", "");
      return;
    }
    lines.push("| Timestamp | Value |", "|---|---|");
    s.timestamps.forEach((t, i) => lines.push(`| ${t} | ${s.values[i]} |`));
    lines.push("");
  });
  return lines.join("\n");
}

function buildAiRequestMessagesJson(
  context: DynamoDbPerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult,
): string {
  const request = analysis.request;
  const prompt = buildDynamoDbAiAnalysisPrompt(context, {
    translateResponse: request?.translateResponse,
    language: request?.language,
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
    2,
  );
}

/** Pure cell-construction step (§13) - kept separate from the write/open I/O below for unit testing. */
export function buildDynamoDbAiAnalysisNotebookCells(
  context: DynamoDbPerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult,
): NotebookCellData[] {
  const cells: NotebookCellData[] = [
    markupCell(buildOverviewMarkdown(context, analysis)),
    markupCell(buildDynamoDbPerformanceSnapshotMarkdown(buildDynamoDbPerformanceTuningHumanSummary(context))),
  ];

  const diagnosticSections = buildDiagnosticSections(context);
  if (diagnosticSections.collectionIssues) {
    cells.push(markupCell(diagnosticSections.collectionIssues));
  }

  cells.push(
    markupCell(buildAccessPatternMarkdown(context)),
    markupCell(buildTableDefinitionMarkdown(context)),
    markupCell(buildObservedRequestMarkdown(context)),
    markupCell(buildCloudWatchMarkdown(context)),
  );

  if (diagnosticSections.information) {
    cells.push(markupCell(diagnosticSections.information));
  }

  cells.push(markupCell(buildAnalysisMarkdown(analysis)));

  const rawMetricsAppendix = buildRawMetricsAppendixMarkdown(context);
  if (rawMetricsAppendix) {
    cells.push(markupCell(rawMetricsAppendix));
  }

  cells.push(
    markupCell(buildJsonAppendixMarkdown()),
    jsonCodeCell(JSON.stringify(context, null, 2), "Full context JSON"),
    jsonCodeCell(buildAiRequestMessagesJson(context, analysis), "AI request messages"),
    jsonCodeCell(JSON.stringify(analysis, null, 2), "AI analysis JSON"),
  );
  return cells;
}

const REPORTS_SUBPATH = ["reports", "performance-tuning"] as const;

/**
 * Writes and opens a new Notebook under `<workspace root>/reports/performance-tuning/`
 * (auto-created if missing), containing the DynamoDB context/AI analysis
 * cells above (§13). Never appends to an existing Notebook and never
 * prompts a save dialog - same product decision as the RDB version (§16.1).
 * Re-validates the context immediately before writing
 * (validateDynamoDbPerformanceTuningContext()) as a last defense-in-depth
 * check that no Item/bind/LastEvaluatedKey data has somehow made it into
 * what's about to be saved (§13's own closing sentence) - this never
 * happens by construction elsewhere in the collection pipeline, so a
 * violation here indicates a bug upstream, not a normal user-facing error
 * path, but this still fails closed rather than saving anyway.
 */
export async function saveDynamoDbAiAnalysisAsNotebook(
  context: DynamoDbPerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult,
): Promise<SaveAiAnalysisAsNotebookResult> {
  const violations = validateDynamoDbPerformanceTuningContext(context);
  if (violations.length > 0) {
    return {
      ok: false,
      message: `Refusing to save: the collected context failed validation (${violations.join("; ")}).`,
    };
  }

  const wsFolder = workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    return {
      ok: false,
      message:
        "No workspace folder is open, so the AI analysis notebook cannot be saved. Open a workspace folder and try again.",
    };
  }

  const dirUri = Uri.joinPath(wsFolder.uri, ...REPORTS_SUBPATH);
  let filename = buildAiAnalysisNotebookFilename(context.service.tableName);
  let targetUri = Uri.joinPath(dirUri, filename);

  await createDirectory(dirUri);
  // Timestamp resolution is seconds, so a collision is extremely unlikely -
  // guarded anyway so a same-second double-click never silently clobbers a
  // prior save.
  if (await existsUri(targetUri)) {
    filename = filename.replace(/\.dbn$/, `-${Date.now()}.dbn`);
    targetUri = Uri.joinPath(dirUri, filename);
  }

  const cells = buildDynamoDbAiAnalysisNotebookCells(context, analysis);
  await writeNotebookFile(cells, targetUri);
  await openNotebookFile(targetUri, { viewColumn: ViewColumn.Two });

  return { ok: true, relativePath: [...REPORTS_SUBPATH, filename].join("/"), uri: targetUri };
}
