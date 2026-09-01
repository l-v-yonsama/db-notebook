import type {
  DynamoDbCapacityBreakdown,
  DynamoDbPerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { formatUtcWithLocal } from "../../shared/dateTimeDisplay";
import { validateDynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCellData } from "vscode";
import type { PerformanceTuningAiAnalysisResult } from "../../shared/PerformanceTuningAiAnalysis";
import type { DynamoDbPerformanceTuningHumanSummary } from "../../shared/DynamoDbPerformanceTuningHumanSummary";
import { buildDynamoDbPerformanceTuningDiagnosticGroups } from "../report/dynamoDbPerformanceTuningDiagnosticFormatter";
import { buildDynamoDbPerformanceTuningHumanSummary } from "../report/dynamoDbPerformanceTuningHumanSummary";
import { buildDynamoDbAiAnalysisPrompt } from "../ai/dynamoDbPerformanceTuningAiPrompt";
import {
  buildPerformanceTuningNotebookFilename,
  buildAnalysisMarkdown,
  getPerformanceTuningReportKind,
  buildJsonAppendixMarkdown,
  buildNotebookTocMarkdown,
  diagnosticGroupsMarkdown,
  escapeMdCell,
  evidenceLine,
  formatNumber,
  jsonCodeCell,
  markupCell,
  type NotebookTocEntry,
  type PerformanceTuningReportInput,
} from "./performanceTuningAiNotebook";
import {
  savePerformanceTuningNotebookFile,
  type SavePerformanceTuningNotebookResult,
} from "./performanceTuningNotebookFile";
import type { ComparisonAiInput } from "../ai/performanceTuningComparisonAiInput";
import {
  buildComparisonJsonAppendixMarkdown,
  buildComparisonMarkdown,
  type PerformanceTuningComparisonReportInput,
} from "../report/performanceTuningComparisonReport";

// DynamoDB reports reuse the engine-neutral cell and analysis builders.

function escapeMermaidText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mermaidCard(title: string, details: string[]): string {
  return [title, ...details].map(escapeMermaidText).join("<br/>");
}

function accessPathLabel(
  path: DynamoDbPerformanceTuningContext["accessPattern"]["accessPath"]
): string {
  switch (path) {
    case "tableQuery":
      return "Table Query";
    case "indexQuery":
      return "Index Query";
    case "tableScan":
      return "Full table Scan";
    case "indexScan":
      return "Full index Scan";
    default:
      return "Access path unresolved";
  }
}

/** Builds a statement-specific, evidence-aware DynamoDB read funnel. */
export function buildDynamoDbQueryFlowMermaid(context: DynamoDbPerformanceTuningContext): string {
  const { accessPattern, observation, table } = context;
  const requestKind = context.statement.language === "partiql" ? "PartiQL SELECT" : "Native Query";
  const targetDetails = [
    context.service.indexName ? `${accessPattern.indexType ?? "Index"} target` : "Table target",
  ];
  if (table.itemCount?.value !== undefined) {
    targetDetails.push(`Approx. ${formatNumber(table.itemCount.value)} items (AWS estimate)`);
  }

  const keyConditions: string[] = [];
  if (accessPattern.partitionKey?.conditionPresent) {
    keyConditions.push(
      `PK ${accessPattern.partitionKey.attributeName} ${accessPattern.partitionKey.operator ?? "="}`
    );
  } else {
    keyConditions.push("No partition-key equality");
  }
  if (accessPattern.sortKey?.conditionPresent) {
    keyConditions.push(
      `SK ${accessPattern.sortKey.attributeName} ${accessPattern.sortKey.operator ?? "condition"}`
    );
  }

  const filterDetails = accessPattern.postReadFilter.present
    ? [
        "Post-read filter",
        accessPattern.postReadFilter.attributes.length > 0
          ? accessPattern.postReadFilter.attributes.join(", ")
          : "Attributes unresolved",
      ]
    : ["No post-read filter"];

  const resultDetails: string[] = [
    observation?.returnedItemCount !== undefined
      ? `${formatNumber(observation.returnedItemCount)} items returned`
      : "Returned items not measured",
  ];
  const capacity = observation?.consumedCapacity;
  if (capacity) {
    resultDetails.push(`Consumed Capacity: ${formatCapacity(capacity)} CU`);
  }
  if (observation?.clientElapsedTimeMs !== undefined) {
    resultDetails.push(`Client time: ${formatNumber(observation.clientElapsedTimeMs)} ms`);
  }
  if (observation?.bounded) {
    resultDetails.push("Single bounded response");
  }

  const evaluatedLabel =
    observation?.evaluatedItemCount !== undefined
      ? `${formatNumber(observation.evaluatedItemCount)} evaluated`
      : observation && context.statement.language === "partiql"
      ? "Evaluated count unavailable in PartiQL"
      : "Evaluation not measured";
  const returnedLabel =
    observation?.returnedItemCount !== undefined
      ? `${formatNumber(observation.returnedItemCount)} returned${
          observation.filterPassRate !== undefined
            ? ` (${(observation.filterPassRate * 100).toFixed(2)}% pass)`
            : ""
        }`
      : "Return count not measured";

  return [
    "flowchart LR",
    // Mermaid 11's HTML renderer treats a leading `1. ` as a Markdown
    // ordered-list marker and replaces the whole node with "Unsupported
    // markdown: list". Prefixing the number keeps the same visible sequence
    // while remaining portable between VS Code's and the HTML renderer.
    `  Request["${mermaidCard("Step 1: Request", [requestKind])}"]`,
    `  Target["${mermaidCard(`Step 2: Target: ${targetRef(context)}`, targetDetails)}"]`,
    `  Access["${mermaidCard("Step 3: Key access", [accessPathLabel(accessPattern.accessPath)])}"]`,
    `  Filter["${mermaidCard("Step 4: Filter", filterDetails)}"]`,
    `  Result["${mermaidCard("Step 5: Result", resultDetails)}"]`,
    `  Request -->|"${escapeMermaidText(
      context.service.indexName ? "Index request" : "Table request"
    )}"| Target`,
    `  Target -->|"${escapeMermaidText(keyConditions.join(" · "))}"| Access`,
    `  Access -->|"${escapeMermaidText(evaluatedLabel)}"| Filter`,
    `  Filter -->|"${escapeMermaidText(returnedLabel)}"| Result`,
  ].join("\n");
}

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
  analysis: PerformanceTuningAiAnalysisResult | undefined
): string {
  const lines: string[] = [];
  lines.push("## 1. Overview");
  lines.push("");
  lines.push(
    "_This report analyzes one DynamoDB read and keeps the detailed access, observation, and CloudWatch evidence after the summary for verification._"
  );
  lines.push("");
  lines.push("| Item | Detail |");
  lines.push("|---|---|");
  lines.push(`| Target | ${escapeMdCell(targetRef(context))} |`);
  if (context.service.region) {
    lines.push(`| Region | ${context.service.region} |`);
  }
  lines.push(`| Collected at | ${formatUtcWithLocal(context.collection.collectedAt)} |`);
  lines.push(`| Collection status | ${context.collection.status} |`);
  // Comparison and evidence reports may not include an AI run.
  if (analysis) {
    lines.push(
      `| AI model | ${analysis.model.name ?? analysis.model.family} (${analysis.model.vendor}) |`
    );
    lines.push(
      `| AI input detail | ${analysis.request?.contextDetail === "compact" ? "Compact" : "Full"} |`
    );
    const tokenUsage = analysis.request?.tokenUsage;
    if (tokenUsage) {
      const percentage =
        tokenUsage.maxInputTokens > 0
          ? `${((tokenUsage.inputTokens / tokenUsage.maxInputTokens) * 100).toFixed(1)}%`
          : "-";
      lines.push(
        `| Estimated AI input | ${formatNumber(tokenUsage.inputTokens)} / ${formatNumber(
          tokenUsage.maxInputTokens
        )} tokens (${percentage}) |`
      );
      lines.push(`| Token safety margin | ${formatNumber(tokenUsage.safetyMargin)} tokens |`);
    }
    lines.push(`| Analyzed at | ${formatUtcWithLocal(analysis.generatedAt)} |`);
    lines.push(`| Confidence | ${analysis.confidence} |`);
  } else {
    lines.push("| AI analysis | Not run - this report contains collected evidence only |");
  }
  return lines.join("\n");
}

function buildTargetRequestMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const lines = ["## 2. Target request", ""];
  if (context.statement.text) {
    lines.push("```sql", context.statement.text, "```");
  } else {
    lines.push(
      `Native Query on ${escapeMdCell(
        targetRef(context)
      )}. See Access pattern below for the resolved key condition/filter/projection.`
    );
  }
  return lines.join("\n");
}

function buildQueryFlowMarkdown(context: DynamoDbPerformanceTuningContext): string {
  return [
    "## 5. Query flow",
    "",
    "_This is a statement-specific read flow, not an optimizer execution plan. Target item count is an AWS approximation; evaluated/returned counts, Capacity, and time come from one observation only._",
    "",
    "```mermaid",
    buildDynamoDbQueryFlowMermaid(context),
    "```",
  ].join("\n");
}

export function buildDynamoDbPerformanceSnapshotMarkdown(
  summary: DynamoDbPerformanceTuningHumanSummary
): string {
  const lines = [
    "### 4.1. Performance snapshot",
    "",
    "_Deterministic summaries of collected DynamoDB facts; these are separate from the AI analysis._",
    "",
    "| Operation | Access path | Target | Evidence | Collection |",
    "|---|---|---|---|---|",
    `| ${summary.profile.operation} | ${summary.profile.accessPath}${
      summary.profile.confidence === "unknown" ? " (unresolved)" : ""
    } | ${escapeMdCell(summary.profile.targetRef)} | ${summary.profile.evidence} | ${
      summary.profile.collectionStatus
    } |`,
    "",
    "#### 4.1.1. Observed signals",
    "",
    "| Level | Signal | Observation | Raw data |",
    "|---|---|---|---|",
  ];
  summary.signals.forEach((signal) => {
    lines.push(
      `| ${signal.level} | ${escapeMdCell(signal.title)} | ${escapeMdCell(
        signal.summary
      )} | ${escapeMdCell(signal.rawDataPath)} |`
    );
  });
  return lines.join("\n");
}

function buildDiagnosticSections(context: DynamoDbPerformanceTuningContext): {
  collectionIssues: string;
  information: string;
} {
  const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
    context.collection.diagnostics,
    context.collection.unavailableSections
  );
  const issues = groups.filter((group) => group.severity === "warning");
  const information = groups.filter((group) => group.severity === "info");

  return {
    collectionIssues: [
      "## 3. Collection status",
      "",
      `**Status:** ${context.collection.status}`,
      "",
      ...(issues.length > 0
        ? diagnosticGroupsMarkdown(issues)
        : ["_No collection issues were reported._"]),
    ].join("\n"),
    information:
      information.length > 0
        ? [
            "## 10. Additional information",
            "",
            "_The items below describe access-pattern/collection characteristics. On their own, they don't indicate a confirmed performance problem — see each item's technical details._",
            "",
            ...diagnosticGroupsMarkdown(information),
          ].join("\n")
        : [
            "## 10. Additional information",
            "",
            "_No additional access-pattern or collection information was reported._",
          ].join("\n"),
  };
}

export function buildAccessPatternMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const { accessPattern } = context;
  const lines = ["## 6. Access pattern", ""];
  if (accessPattern.confidence === "unknown") {
    lines.push(
      "_This statement's access path could not be safely classified. Treat the read cost as unknown._",
      ""
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
    } |`
  );
  if (accessPattern.sortKey) {
    lines.push(
      `| Sort key | ${accessPattern.sortKey.attributeName}${
        accessPattern.sortKey.conditionPresent
          ? ` ${accessPattern.sortKey.operator ?? ""}`
          : " (no condition)"
      } |`
    );
  }
  lines.push(
    `| Post-read filter | ${
      accessPattern.postReadFilter.present
        ? escapeMdCell(
            accessPattern.postReadFilter.attributes.join(", ") ||
              "present (attributes not resolved)"
          )
        : "None"
    } |`
  );
  lines.push(
    `| Projection | ${
      accessPattern.projection.mode === "allAttributes" || accessPattern.projection.allAttributes
        ? "All table attributes"
        : accessPattern.projection.mode === "allProjectedAttributes"
        ? "All projected index attributes"
        : escapeMdCell(accessPattern.projection.attributes.join(", ") || "Specific (not resolved)")
    } |`
  );
  lines.push(`| Consistency | ${accessPattern.consistentRead} |`);
  if (accessPattern.limit !== undefined) {
    lines.push(`| DynamoDB API Limit | ${accessPattern.limit} |`);
  }
  if (accessPattern.resultItemLimit !== undefined) {
    lines.push(`| Max returned items | ${accessPattern.resultItemLimit} |`);
  }
  if (accessPattern.scanForward !== undefined) {
    lines.push(`| Scan direction | ${accessPattern.scanForward ? "Forward" : "Backward"} |`);
  }
  return lines.join("\n");
}

export function buildTableDefinitionMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const { table } = context;
  const lines = ["## 8. Table and index information", "", "| Field | Value |", "|---|---|"];
  lines.push(`| Billing mode | ${table.billingMode} |`);
  lines.push(
    `| Partition key | ${table.keySchema.partitionKey.attributeName} (${table.keySchema.partitionKey.attributeType}) |`
  );
  if (table.keySchema.sortKey) {
    lines.push(
      `| Sort key | ${table.keySchema.sortKey.attributeName} (${table.keySchema.sortKey.attributeType}) |`
    );
  }
  if (table.itemCount) {
    lines.push(`| Item count | ${formatNumber(table.itemCount.value)} (approximate) |`);
  }
  if (table.tableSizeBytes) {
    lines.push(`| Table size | ${formatNumber(table.tableSizeBytes.value)} bytes (approximate) |`);
  }
  if (table.ttl) {
    lines.push(
      `| TTL | ${table.ttl.status}${
        table.ttl.attributeName ? ` (${table.ttl.attributeName})` : ""
      } |`
    );
  }

  const allIndexes = [...table.localSecondaryIndexes, ...table.globalSecondaryIndexes];
  if (allIndexes.length > 0) {
    lines.push(
      "",
      "### 8.1. Indexes",
      "",
      "| Name | Type | Partition key | Sort key | Projection |",
      "|---|---|---|---|---|"
    );
    allIndexes.forEach((idx) => {
      lines.push(
        `| ${escapeMdCell(idx.indexName)} | ${idx.indexType} | ${
          idx.keySchema.partitionKey.attributeName
        } | ${idx.keySchema.sortKey?.attributeName ?? "-"} | ${idx.projection.projectionType}${
          idx.projection.nonKeyAttributes && idx.projection.nonKeyAttributes.length > 0
            ? ` (${escapeMdCell(idx.projection.nonKeyAttributes.join(", "))})`
            : ""
        } |`
      );
    });
  }

  if (table.contributorInsights.length > 0) {
    lines.push(
      "",
      `_Contributor Insights: ${escapeMdCell(
        table.contributorInsights.map((ci) => `${ci.indexName ?? "table"}: ${ci.status}`).join(", ")
      )}_`
    );
  }
  return lines.join("\n");
}

export function buildObservedRequestMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const lines = ["## 7. Observed measurements", ""];
  const observation = context.observation;
  if (!observation) {
    lines.push("_No read has been observed for this exact statement yet._");
  } else {
    lines.push("| Field | Value |", "|---|---|");
    lines.push(
      `| Result coverage | ${
        observation.completeness === "complete" && !observation.bounded
          ? "✅ **COMPLETE** — the read reached the end of the result"
          : "⚠️ **INCOMPLETE** — the full result was not observed"
      } |`
    );
    lines.push(`| Source | ${observation.source} |`);
    if (observation.observedAt) {
      lines.push(`| Observed at | ${formatUtcWithLocal(observation.observedAt)} |`);
    }
    lines.push(`| Returned items | ${observation.returnedItemCount ?? "-"} |`);
    if (observation.evaluatedItemCount !== undefined) {
      lines.push(`| Evaluated items | ${observation.evaluatedItemCount} |`);
    }
    if (observation.filterPassRate !== undefined) {
      lines.push(`| Filter pass rate | ${(observation.filterPassRate * 100).toFixed(2)}% |`);
    }
    if (observation.consumedCapacity) {
      lines.push(`| Consumed Capacity | ${formatCapacity(observation.consumedCapacity)} |`);
    }
    if (observation.clientElapsedTimeMs !== undefined) {
      lines.push(`| Client elapsed time | ${formatNumber(observation.clientElapsedTimeMs)} ms |`);
    }
    lines.push(
      `| Request / retry count | ${observation.requestCount ?? "-"} / ${
        observation.retryCount ?? "-"
      } |`
    );
    if (observation.bounded) {
      lines.push(
        "",
        `_${
          observation.boundDescription ??
          "This observation is bounded and may not reflect the statement's full result."
        }_`
      );
    }
  }
  if (context.benchmark) {
    const benchmark = context.benchmark;
    const benchmarkStates = [...new Set(benchmark.samples.map((sample) => sample.completeness))];
    const benchmarkCompleteness =
      benchmark.completeness ?? (benchmarkStates.length === 1 ? benchmarkStates[0] : "mixed");
    const benchmarkComplete = benchmarkCompleteness === "complete";
    lines.push(
      "",
      "### 7.1. Benchmark measurements",
      "",
      benchmark.mode === "completeResult"
        ? "_Each sample followed continuation tokens up to the complete-result safety limits._"
        : "_Each sample measured one bounded API response._",
      "",
      "| Item | Value |",
      "|---|---|",
      `| Result coverage | ${
        benchmarkComplete
          ? "✅ **COMPLETE** — every run reached the end of the result"
          : `⚠️ **INCOMPLETE** — ${
              benchmark.boundDescription ?? `benchmark coverage was ${benchmarkCompleteness}`
            }`
      } |`,
      `| Started at | ${formatUtcWithLocal(benchmark.startedAt)} |`,
      `| Completed at | ${formatUtcWithLocal(benchmark.completedAt)} |`,
      `| Runs | ${benchmark.completedRuns} / ${benchmark.requestedRuns} completed |`,
      `| Median | ${formatNumber(benchmark.medianClientElapsedTimeMs)} ms |`,
      `| Average | ${formatNumber(benchmark.averageClientElapsedTimeMs)} ms |`,
      `| Min / Max | ${formatNumber(benchmark.minClientElapsedTimeMs)} / ${formatNumber(
        benchmark.maxClientElapsedTimeMs
      )} ms |`,
      "",
      "| Run | Client elapsed | Returned / evaluated | Consumed read capacity |",
      "|---|---|---|---|",
      ...benchmark.samples.map(
        (sample) =>
          `| ${sample.run} | ${formatNumber(sample.clientElapsedTimeMs)} ms | ${formatNumber(
            sample.returnedItemCount
          )} / ${formatNumber(sample.evaluatedItemCount)} | ${
            sample.consumedCapacity ? formatCapacity(sample.consumedCapacity) : "-"
          } |`
      ),
      ""
    );
  }
  return lines.join("\n");
}

function seriesScopeLabel(
  series: NonNullable<DynamoDbPerformanceTuningContext["cloudWatch"]>["series"][number]
): string {
  return `${series.scope}${series.indexName ? ` (${series.indexName})` : ""}${
    series.operation ? ` / ${series.operation}` : ""
  }`;
}

export function buildCloudWatchMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const lines = ["## 9. CloudWatch metrics", ""];
  const cw = context.cloudWatch;
  if (!cw) {
    lines.push("_CloudWatch metrics were not collected._");
    return lines.join("\n");
  }
  lines.push(
    `Window: ${formatUtcWithLocal(cw.window.startTime)} – ${formatUtcWithLocal(
      cw.window.endTime
    )} (period ${
      cw.window.periodSeconds
    }s). Table/index/operation-level activity over that window, not only this statement.`,
    ""
  );
  if (cw.series.length === 0) {
    lines.push("_No CloudWatch series were collected._");
    return lines.join("\n");
  }
  lines.push("| Metric | Scope | Statistic | Latest | Max |", "|---|---|---|---|---|");
  cw.series.forEach((s) => {
    const scope = escapeMdCell(seriesScopeLabel(s));
    if (s.noData) {
      lines.push(
        `| ${escapeMdCell(s.metricName)} | ${scope} | ${s.statistic} | no data | no data |`
      );
      return;
    }
    const latest = s.values.length > 0 ? s.values[s.values.length - 1] : "-";
    const max = s.values.length > 0 ? Math.max(...s.values) : "-";
    lines.push(
      `| ${escapeMdCell(s.metricName)} | ${scope} | ${s.statistic} | ${latest} | ${max} |`
    );
  });
  return lines.join("\n");
}

// Keep full datapoints in an appendix while the main CloudWatch section stays concise.
function buildRawMetricsAppendixMarkdown(context: DynamoDbPerformanceTuningContext): string {
  const cw = context.cloudWatch;
  if (!cw || cw.series.length === 0) {
    return [
      "## Appendix A. Raw CloudWatch metrics",
      "",
      "_No raw CloudWatch datapoints were collected._",
    ].join("\n");
  }
  const lines = [
    "## Appendix A. Raw CloudWatch metrics",
    "",
    "_Full CloudWatch datapoints behind the summarized table above._",
    "",
  ];
  let subsection = 1;
  cw.series.forEach((s) => {
    lines.push(
      `### A.${subsection++}. ${escapeMdCell(s.metricName)} (${s.statistic}) - ${escapeMdCell(
        seriesScopeLabel(s)
      )}`,
      ""
    );
    if (s.noData || s.timestamps.length === 0) {
      lines.push("_No datapoints for this window._", "");
      return;
    }
    lines.push("| Timestamp | Value |", "|---|---|");
    s.timestamps.forEach((t, i) => lines.push(`| ${formatUtcWithLocal(t)} | ${s.values[i]} |`));
    lines.push("");
  });
  return lines.join("\n");
}

function buildAiRequestMessagesJson(
  context: DynamoDbPerformanceTuningContext,
  analysis: PerformanceTuningAiAnalysisResult,
  comparisonInput: ComparisonAiInput | undefined
): string {
  const request = analysis.request;
  const prompt = buildDynamoDbAiAnalysisPrompt(context, {
    translateResponse: request?.translateResponse,
    language: request?.language,
    contextDetail: request?.contextDetail,
    comparison: comparisonInput,
  });
  return JSON.stringify(
    {
      promptFormatVersion: request?.promptFormatVersion ?? 1,
      model: analysis.model,
      ...(request?.tokenUsage ? { tokenUsage: request.tokenUsage } : {}),
      ...(request?.comparison ? { comparison: request.comparison } : {}),
      messages: [
        { role: "assistant", content: prompt.assistant },
        { role: "user", content: prompt.user },
      ],
    },
    null,
    2
  );
}

/** Builds the complete DynamoDB report without performing file I/O. */
export function buildDynamoDbAiAnalysisNotebookCells(
  context: DynamoDbPerformanceTuningContext,
  input: PerformanceTuningReportInput
): NotebookCellData[] {
  const { analysis, comparison } = input;
  const reportKind = getPerformanceTuningReportKind(input);
  const tocEntries: NotebookTocEntry[] = [
    { label: "1. Overview", anchor: "1-overview" },
    { label: "2. Target request", anchor: "2-target-request" },
    { label: "3. Collection status", anchor: "3-collection-status" },
    { label: "4. Summary and recommendations", anchor: "4-summary-and-recommendations" },
    { label: "5. Query flow", anchor: "5-query-flow" },
    { label: "6. Access pattern", anchor: "6-access-pattern" },
    { label: "7. Observed / benchmark measurements", anchor: "7-observed-measurements" },
    { label: "8. Table and index information", anchor: "8-table-and-index-information" },
    { label: "9. CloudWatch metrics", anchor: "9-cloudwatch-metrics" },
    { label: "10. Additional information", anchor: "10-additional-information" },
    // Appended, not inserted - see the RDB builder's own comment on why the
    // existing chapters keep their numbers.
    ...(comparison
      ? [{ label: "11. Comparison with baseline", anchor: "11-comparison-with-baseline" }]
      : []),
    { label: "Appendix A. Raw CloudWatch metrics", anchor: "appendix-a-raw-cloudwatch-metrics" },
    { label: "Appendix B. Raw data", anchor: "appendix-b-raw-data" },
    ...(comparison
      ? [{ label: "Appendix C. Comparison raw data", anchor: "appendix-c-comparison-raw-data" }]
      : []),
  ];
  const diagnosticSections = buildDiagnosticSections(context);
  const cells: NotebookCellData[] = [
    markupCell(
      buildNotebookTocMarkdown(
        reportKind === "comparison"
          ? "DynamoDB Performance Tuning Comparison Report"
          : reportKind === "analysis"
          ? "DynamoDB Performance Tuning AI Analysis"
          : "DynamoDB Performance Tuning Evidence Report",
        tocEntries,
        context.collection.status
      ),
      { excludeFromHtml: true }
    ),
    markupCell(buildOverviewMarkdown(context, analysis)),
    markupCell(buildTargetRequestMarkdown(context)),
    markupCell(diagnosticSections.collectionIssues),
    markupCell(
      [
        "## 4. Summary and recommendations",
        "",
        buildDynamoDbPerformanceSnapshotMarkdown(
          buildDynamoDbPerformanceTuningHumanSummary(context)
        ),
        "",
        buildAnalysisMarkdown(analysis),
      ].join("\n")
    ),
    markupCell(buildQueryFlowMarkdown(context)),
    markupCell(buildAccessPatternMarkdown(context)),
    markupCell(buildObservedRequestMarkdown(context)),
    markupCell(buildTableDefinitionMarkdown(context)),
    markupCell(buildCloudWatchMarkdown(context)),
    markupCell(diagnosticSections.information),
    ...(comparison
      ? [
          markupCell(
            buildComparisonMarkdown(
              comparison.evidence,
              comparison.evidence.source.baseline.fileName,
              { section: "11" }
            )
          ),
        ]
      : []),
    markupCell(buildRawMetricsAppendixMarkdown(context)),
    markupCell(buildJsonAppendixMarkdown("Appendix B")),
    jsonCodeCell(JSON.stringify(context, null, 2), "Full context JSON"),
    ...(analysis
      ? [
          jsonCodeCell(
            buildAiRequestMessagesJson(context, analysis, input.analysisComparisonInput),
            "AI request messages"
          ),
          jsonCodeCell(JSON.stringify(analysis, null, 2), "AI analysis JSON"),
        ]
      : []),
    ...(comparison
      ? [
          markupCell(buildComparisonJsonAppendixMarkdown("Appendix C")),
          jsonCodeCell(JSON.stringify(comparison.evidence, null, 2), "Comparison Evidence JSON"),
          jsonCodeCell(
            JSON.stringify(comparison.baselineContext, null, 2),
            "Baseline Full context JSON"
          ),
          // Keep both labels for compatibility and future baseline selection.
          jsonCodeCell(JSON.stringify(context, null, 2), "Current Full context JSON"),
        ]
      : []),
  ];
  return cells;
}

/** Validates, writes, and opens a DynamoDB performance report. */
export async function saveDynamoDbAiAnalysisAsNotebook(
  context: DynamoDbPerformanceTuningContext,
  input: PerformanceTuningReportInput
): Promise<SavePerformanceTuningNotebookResult> {
  const violations = validateDynamoDbPerformanceTuningContext(context);
  if (violations.length > 0) {
    return {
      ok: false,
      message: `Refusing to save: the collected context failed validation (${violations.join(
        "; "
      )}).`,
    };
  }
  const filename = buildPerformanceTuningNotebookFilename(
    context.service.tableName,
    getPerformanceTuningReportKind(input)
  );
  return savePerformanceTuningNotebookFile({
    filename,
    cells: buildDynamoDbAiAnalysisNotebookCells(context, input),
  });
}
