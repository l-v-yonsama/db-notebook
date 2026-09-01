// Engine-neutral, side-effect-free comparison report rendering.

import type {
  AnyTuningContext,
  ComparisonValue,
  IndexChange,
  IndexSnapshot,
  NumericComparison,
  PerformanceTuningComparisonEvidence,
} from "../shared/PerformanceTuningComparison";
import { formatUtcWithLocal } from "../shared/dateTimeDisplay";

// Deliberately a local copy of performanceTuningAiNotebook.ts's escapeMdCell()
// rather than an import of it: that module imports this one (it owns the
// report's cell list), and a two-line defensive escape is not worth a runtime
// circular import to share.
function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br/>");
}

/** Section numbers differ per engine, so the caller supplies the prefix. */
export type ComparisonSectionNumbering = {
  // e.g. "5" -> "## 5. Comparison with baseline", "### 5.1. ..."
  section: string;
};

/**
 * What a report needs in order to carry a comparison. The Baseline Context is
 * passed alongside the evidence rather than embedded in it: the evidence is
 * also what the Preview renders and what the AI projection is built from, and
 * neither of those needs a second whole Context. The saved report does - §14
 * requires it to stay readable with the original baseline `.dbn` gone.
 */
export type PerformanceTuningComparisonReportInput = {
  evidence: PerformanceTuningComparisonEvidence;
  baselineContext: AnyTuningContext;
};

export function buildComparisonMarkdown(
  evidence: PerformanceTuningComparisonEvidence,
  baselineFileName: string,
  numbering: ComparisonSectionNumbering
): string {
  const n = numbering.section;
  return [
    `## ${n}. Comparison with baseline`,
    "",
    "_Every figure in this chapter was computed by the extension from the two collected contexts, not by an AI. " +
      "The two contexts are snapshots from different points in time, so a difference is an observation, not proof " +
      "of a cause._",
    "",
    ...summaryTable(evidence, baselineFileName, n),
    "",
    ...keyChanges(evidence, n),
    "",
    ...queryChanges(evidence, n),
    "",
    ...accessPathChanges(evidence, n),
    "",
    ...indexChanges(evidence, n),
    "",
    ...metricTable(evidence, n),
    "",
    ...comparabilityNotes(evidence, n),
    "",
    ...baselineSource(evidence, baselineFileName, n),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 1. Summary
// ---------------------------------------------------------------------------

function summaryTable(
  evidence: PerformanceTuningComparisonEvidence,
  baselineFileName: string,
  n: string
): string[] {
  const level = evidence.comparability.level;
  return [
    `### ${n}.1. Summary`,
    "",
    "| Item | Detail |",
    "|---|---|",
    `| Baseline report | ${escapeMdCell(baselineFileName)} |`,
    `| Baseline collected at | ${
      evidence.source.baseline.collectedAt
        ? formatUtcWithLocal(evidence.source.baseline.collectedAt)
        : "unknown"
    } |`,
    `| Current collected at | ${
      evidence.source.current.collectedAt
        ? formatUtcWithLocal(evidence.source.current.collectedAt)
        : "unknown"
    } |`,
    `| Comparability | ${comparabilityLabel(level)} |`,
    `| Engine | ${evidence.engine === "rdb" ? "Relational database" : "DynamoDB"} |`,
    `| Comparison generated at | ${formatUtcWithLocal(evidence.generatedAt)} |`,
  ];
}

function comparabilityLabel(
  level: PerformanceTuningComparisonEvidence["comparability"]["level"]
): string {
  switch (level) {
    case "comparable":
      return "✅ Comparable";
    case "partiallyComparable":
      return "⚠️ Partially comparable - see the notes below";
    case "notComparable":
      return "⛔ Not comparable - improvement figures are deliberately omitted";
  }
}

// ---------------------------------------------------------------------------
// 2. Key changes
// ---------------------------------------------------------------------------

function keyChanges(evidence: PerformanceTuningComparisonEvidence, n: string): string[] {
  const ranked = allMetrics(evidence)
    .filter(
      (metric) =>
        metric.comparability === "comparable" &&
        metric.improvementPercent !== undefined &&
        Math.abs(metric.improvementPercent) >= 1
    )
    .sort((a, b) => Math.abs(b.improvementPercent!) - Math.abs(a.improvementPercent!))
    .slice(0, 5);

  if (ranked.length === 0) {
    return [
      `### ${n}.2. Key changes`,
      "",
      "_No comparable metric moved by more than 1%. The full table below still lists every value collected on both sides._",
    ];
  }
  return [
    `### ${n}.2. Key changes`,
    "",
    "| Metric | Baseline | Current | Result |",
    "|---|---|---|---|",
    ...ranked.map(
      (metric) =>
        `| ${escapeMdCell(metric.label)} | ${formatValue(
          metric.baseline,
          metric.unit
        )} | ${formatValue(metric.current, metric.unit)} | ${improvementLabel(metric)} |`
    ),
  ];
}

function improvementLabel(metric: NumericComparison): string {
  const improvement = metric.improvementPercent;
  if (improvement === undefined) {
    return "-";
  }
  const rounded = Math.abs(Number(improvement.toFixed(1)));
  return improvement > 0 ? `✅ ${rounded}% better` : `⚠️ ${rounded}% worse`;
}

// ---------------------------------------------------------------------------
// 3. Query changes
// ---------------------------------------------------------------------------

function queryChanges(evidence: PerformanceTuningComparisonEvidence, n: string): string[] {
  const { query } = evidence.common;
  const lines = [`### ${n}.3. Request changes`, ""];
  if (!query.changed) {
    lines.push("_The request text is identical on both sides._");
    return lines;
  }
  const fence = evidence.engine === "rdb" ? "sql" : "text";
  lines.push("**Baseline**", "", `\`\`\`${fence}`, query.baseline?.text ?? "(no text)", "```", "");
  lines.push("**Current**", "", `\`\`\`${fence}`, query.current?.text ?? "(no text)", "```", "");
  if (query.diff.length > 0) {
    lines.push("**Line differences**", "", "```diff");
    for (const line of query.diff) {
      const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
      lines.push(`${marker} ${line.text}`);
    }
    lines.push("```");
    if (query.diffTruncated) {
      lines.push(
        "",
        "_The line differences above were truncated for display; both full request bodies are shown in full above._"
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 4. Access path
// ---------------------------------------------------------------------------

function accessPathChanges(evidence: PerformanceTuningComparisonEvidence, n: string): string[] {
  const lines = [`### ${n}.4. Access path changes`, ""];

  if (evidence.engineSpecific.kind === "rdb") {
    const { accessPath } = evidence.engineSpecific.value;
    if (accessPath.changes.length === 0) {
      lines.push("_Neither plan resolved a table access to compare._");
    } else {
      lines.push("| Table | Baseline | Current | Result |", "|---|---|---|---|");
      for (const change of accessPath.changes) {
        const note = change.ambiguous
          ? `⚠️ ${change.baselineNodeCount} baseline step(s) / ${change.currentNodeCount} current step(s) - not matched one to one`
          : change.changed
          ? "Changed"
          : "No change";
        lines.push(
          `| ${escapeMdCell(change.target)} | ${escapeMdCell(
            describeStep(change.baseline)
          )} | ${escapeMdCell(describeStep(change.current))} | ${note} |`
        );
      }
    }
  } else {
    const value = evidence.engineSpecific.value;
    lines.push("| Property | Baseline | Current |", "|---|---|---|");
    lines.push(valueRow("Operation", value.operation));
    lines.push(valueRow("Access path", value.accessPath));
    lines.push(valueRow("Read target", value.accessTarget));
    lines.push(valueRow("Partition key condition", value.partitionKeyCondition));
    lines.push(valueRow("Sort key condition", value.sortKeyCondition));
    lines.push(valueRow("Post-read filter", value.postReadFilter));
    lines.push(valueRow("Projection", value.projection));
    lines.push(valueRow("Consistent read", value.consistentRead));
    lines.push(valueRow("Scan direction", value.scanDirection));
  }

  const structure = engineStructureRows(evidence);
  if (structure.length > 0) {
    lines.push("", "| Property | Baseline | Current |", "|---|---|---|", ...structure);
  }
  return lines;
}

function describeStep(step: { operation: string; indexName?: string } | undefined): string {
  if (!step) {
    return "-";
  }
  return step.indexName ? `${step.operation} using ${step.indexName}` : step.operation;
}

/**
 * Engine properties that are not part of the access path itself but still
 * describe how the two reads differ - including the three separately-meaning
 * DynamoDB caps §10.3 forbids conflating.
 */
function engineStructureRows(evidence: PerformanceTuningComparisonEvidence): string[] {
  if (evidence.engineSpecific.kind === "rdb") {
    const v = evidence.engineSpecific.value;
    return [
      valueRow("Vendor", v.vendor),
      valueRow("Statement kind", v.statementKind),
      valueRow("Plan mode", v.planMode),
      valueRow("Evidence", v.evidenceKind),
      valueRow("Dominant step", v.dominantCostNode),
    ];
  }
  const v = evidence.engineSpecific.value;
  return [
    valueRow("Request type", v.language),
    valueRow("DynamoDB API Limit", v.limits.apiLimit),
    valueRow("Result item cap (panel)", v.limits.resultItemLimit),
    valueRow("Observation bound", v.limits.observationBound),
    completionValueRow("Observation completeness", v.observationCompleteness),
    completionValueRow("Benchmark completeness", v.benchmarkCompleteness),
    ...(v.cloudWatch ? [valueRow("CloudWatch window", v.cloudWatch.window)] : []),
  ];
}

function valueRow(label: string, value: ComparisonValue<unknown>): string {
  const marker = value.changed ? " ←" : "";
  return `| ${escapeMdCell(label)} | ${escapeMdCell(formatSide(value.baseline))} | ${escapeMdCell(
    formatSide(value.current)
  )}${marker} |`;
}

function completionValueRow(label: string, value: ComparisonValue<unknown>): string {
  const format = (side: unknown): string =>
    side === "complete"
      ? "✅ COMPLETE"
      : side === undefined || side === "not measured"
      ? "➖ NOT MEASURED"
      : `⚠️ INCOMPLETE (${String(side)})`;
  const marker = value.changed ? " ←" : "";
  return `| ${escapeMdCell(label)} | ${escapeMdCell(format(value.baseline))} | ${escapeMdCell(
    format(value.current)
  )}${marker} |`;
}

function formatSide(value: unknown): string {
  if (value === undefined || value === null) {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "(none)" : value.join(", ");
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// 5. Index and schema
// ---------------------------------------------------------------------------

function indexChanges(evidence: PerformanceTuningComparisonEvidence, n: string): string[] {
  const { indexes } = evidence.common;
  const lines = [`### ${n}.5. Index and schema changes`, ""];
  if (indexes.changes.length === 0) {
    lines.push(
      `_All ${indexes.unchangedCount} index definition(s) observed on both sides are identical._`
    );
  } else {
    lines.push(
      "_Two contexts are snapshots from different times, so these are observations about what each side saw - not a record of an index being created or dropped._",
      "",
      "| Observation | Index |",
      "|---|---|",
      ...indexes.changes.map((change) => {
        const described = describeIndexChange(change);
        return `| ${escapeMdCell(described.label)} | ${escapeMdCell(described.detail)} |`;
      })
    );
  }
  lines.push(
    "",
    "| Item | Baseline | Current |",
    "|---|---|---|",
    valueRow("Indexes used by the request", indexes.used)
  );
  return lines;
}

function describeIndexChange(change: IndexChange): { label: string; detail: string } {
  switch (change.kind) {
    case "observedOnlyInCurrent":
      return { label: "Not in baseline, observed now", detail: describeIndex(change.current) };
    case "observedOnlyInBaseline":
      return { label: "In baseline, not observed now", detail: describeIndex(change.baseline) };
    case "definitionChanged":
      return {
        label: `Definition differs (${change.changedFields.join(", ")})`,
        detail: `${describeIndex(change.baseline)} → ${describeIndex(change.current)}`,
      };
  }
}

function describeIndex(index: IndexSnapshot): string {
  const parts = [`${index.scope}.${index.indexName}`, `(${index.columns.join(", ")})`];
  if (index.unique) {
    parts.push("unique");
  }
  if (index.kind) {
    parts.push(index.kind);
  }
  if (index.includedColumns?.length) {
    parts.push(`include (${index.includedColumns.join(", ")})`);
  }
  if (index.predicate) {
    parts.push(`where ${index.predicate}`);
  }
  if (index.projectionType) {
    parts.push(`projection ${index.projectionType}`);
  }
  if (index.nonKeyAttributes?.length) {
    parts.push(`non-key (${index.nonKeyAttributes.join(", ")})`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 6. Metric comparison
// ---------------------------------------------------------------------------

function metricTable(evidence: PerformanceTuningComparisonEvidence, n: string): string[] {
  const metrics = allMetrics(evidence);
  const lines = [`### ${n}.6. Metric comparison`, ""];
  if (metrics.length === 0) {
    lines.push("_Neither side collected a metric the other could be compared against._");
    return lines;
  }
  lines.push(
    "| Metric | Baseline | Current | Change | Assessment |",
    "|---|---|---|---|---|",
    ...metrics.map(
      (metric) =>
        `| ${escapeMdCell(metric.label)} | ${formatValue(
          metric.baseline,
          metric.unit
        )} | ${formatValue(metric.current, metric.unit)} | ${formatChange(
          metric
        )} | ${assessmentLabel(metric)} |`
    )
  );
  const guidance = new Map<string, NonNullable<NumericComparison["missingDataGuidance"]>>();
  for (const metric of metrics) {
    if (metric.missingDataGuidance) {
      guidance.set(
        `${metric.missingDataGuidance.action}\u0000${metric.missingDataGuidance.detail}`,
        metric.missingDataGuidance
      );
    }
  }
  if (guidance.size > 0) {
    lines.push("", "**How to collect missing benchmark data**", "");
    for (const item of guidance.values()) {
      lines.push(`- **${escapeMdCell(item.action)}:** ${escapeMdCell(item.detail)}`);
    }
  }
  return lines;
}

/**
 * Never produces an improvement figure for a metric the evidence rejected -
 * §11's rule that a not-comparable metric may still show both raw values, but
 * no rate and no verdict.
 */
function formatChange(metric: NumericComparison): string {
  if (
    metric.comparability === "notComparable" ||
    metric.baseline === undefined ||
    metric.current === undefined
  ) {
    return "-";
  }
  const parts: string[] = [];
  if (metric.absoluteDelta !== undefined) {
    parts.push(`${metric.absoluteDelta > 0 ? "+" : ""}${roundForDisplay(metric.absoluteDelta)}`);
  }
  if (metric.percentagePointDelta !== undefined) {
    parts.push(
      `${metric.percentagePointDelta > 0 ? "+" : ""}${roundForDisplay(
        metric.percentagePointDelta
      )} pt`
    );
  } else if (metric.percentChange !== undefined) {
    parts.push(`${metric.percentChange > 0 ? "+" : ""}${roundForDisplay(metric.percentChange)}%`);
  }
  return parts.join(" / ") || "-";
}

function assessmentLabel(metric: NumericComparison): string {
  switch (metric.assessment) {
    case "improved":
      return `✅ Improved${improvementSuffix(metric)}`;
    case "regressed":
      return `⚠️ Worse${improvementSuffix(metric)}`;
    case "unchanged":
      return "➖ No change";
    case "changed":
      return "↔️ Changed";
    case "noData":
      return metric.missingDataGuidance
        ? `▶ ${escapeMdCell(metric.missingDataGuidance.action)}`
        : "❔ Only one side has a value";
    case "notComparable":
      return `❔ Not comparable${metric.reason ? ` - ${escapeMdCell(metric.reason)}` : ""}`;
  }
}

function improvementSuffix(metric: NumericComparison): string {
  if (metric.improvementPercent === undefined) {
    return "";
  }
  return ` (${Math.abs(Number(metric.improvementPercent.toFixed(1)))}%)`;
}

// ---------------------------------------------------------------------------
// 7. Comparability notes
// ---------------------------------------------------------------------------

function comparabilityNotes(evidence: PerformanceTuningComparisonEvidence, n: string): string[] {
  const lines = [`### ${n}.7. Comparability notes`, ""];
  const { reasons } = evidence.comparability;
  if (reasons.length === 0) {
    lines.push("_No caveats were recorded._");
    return lines;
  }
  lines.push("| Level | Note |", "|---|---|");
  for (const reason of reasons) {
    const icon =
      reason.level === "notComparable"
        ? "⛔"
        : reason.level === "partiallyComparable"
        ? "⚠️"
        : "ℹ️";
    const detail = reason.detail ? ` (${reason.detail})` : "";
    lines.push(`| ${icon} ${reason.code} | ${escapeMdCell(`${reason.message}${detail}`)} |`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 8. Baseline source
// ---------------------------------------------------------------------------

function baselineSource(
  evidence: PerformanceTuningComparisonEvidence,
  baselineFileName: string,
  n: string
): string[] {
  const { baseline } = evidence.source;
  const lines = [
    `### ${n}.8. Baseline source`,
    "",
    "| Item | Detail |",
    "|---|---|",
    `| File | ${escapeMdCell(baselineFileName)} |`,
    `| Selected at | ${formatUtcWithLocal(baseline.selectedAt)} |`,
    `| Context SHA-256 | \`${baseline.contextSha256}\` |`,
  ];
  if (baseline.sourcePath) {
    // The absolute path is local-environment information, so it is recorded
    // here for reproducibility rather than in the report header (§14).
    lines.push(`| Path at selection time | ${escapeMdCell(baseline.sourcePath)} |`);
  }
  lines.push(
    "",
    "_The baseline context itself is stored in this report (see **Baseline Full context JSON**), so this comparison " +
      "stays readable even if the file above is later moved, edited, or deleted._"
  );
  return lines;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function allMetrics(evidence: PerformanceTuningComparisonEvidence): NumericComparison[] {
  return [...evidence.common.workload.metrics, ...evidence.engineSpecific.value.metrics];
}

function formatValue(value: number | undefined, unit: string): string {
  if (value === undefined) {
    return "-";
  }
  const rendered = roundForDisplay(value);
  return unit && unit !== "ratio" && unit !== "fraction" ? `${rendered} ${unit}` : rendered;
}

/** Rounding happens only at render time; the Evidence JSON keeps raw values (§10.1). */
function roundForDisplay(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString("en-US");
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 100) {
    return value.toFixed(0);
  }
  if (magnitude >= 1) {
    return value.toFixed(2);
  }
  return Number(value.toPrecision(4)).toString();
}

/**
 * The raw-data cells a comparison report adds (§14 items 8-10). The Current
 * context keeps its existing unprefixed `Full context JSON` label for
 * compatibility with readers written before this feature, and gains a
 * `Current Full context JSON` copy that extractBaselineContext() prefers, so
 * chaining a second comparison off this report never reaches back to the
 * older baseline (§6.2, §14).
 */
export function buildComparisonJsonAppendixMarkdown(appendixLabel: string): string {
  return [
    `## ${appendixLabel}. Comparison raw data`,
    "",
    "**Comparison Evidence JSON** holds every figure in the comparison chapter, unrounded, together with the " +
      "per-metric comparability decisions. **Baseline Full context JSON** and **Current Full context JSON** are the " +
      "two contexts it was computed from, exactly as collected. Selecting this report as a baseline later reads the " +
      "**Current** one.",
  ].join("\n");
}
