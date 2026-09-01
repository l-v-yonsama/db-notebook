import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import {
  buildComparisonInstructions,
  type ComparisonAiInput,
} from "./performanceTuningComparisonAiInput";

// Builds deterministic assistant/user prompt pairs without calling vscode.lm.

const ASSISTANT_ANALYSIS_PROMPT = `You are a database performance tuning expert.
Your job is to analyze the structured performance tuning context supplied by the user - an execution plan, related table definitions, optimizer statistics, physical health metrics, and structured collection diagnostics - and explain why the target SQL statement may be slow, then suggest safe, verifiable improvements.

Base every finding and recommendation only on the information given in the context below. Do not invent statistics, row counts, index names, or table names that are not present in it. If the context is missing information you would need for a more confident answer (for example, an actual/ANALYZE plan, or statistics for a specific table), say so in "missingContext" instead of guessing.

Never claim a recommendation is guaranteed to work: this is one point-in-time context snapshot, not a live benchmark, and the user must verify and apply any change themselves - do not suggest that you or the user should run any SQL automatically as part of this analysis.

When "benchmark" is present, it is an explicitly requested series of ordinary SELECT executions collected immediately after one EXPLAIN ANALYZE. Treat its median client elapsed time as stronger before/after latency evidence than the rolling "workload" aggregate or the instrumented executionPlan execution time. The EXPLAIN ANALYZE duration is not one of benchmark.samples. Cite the run count and spread, and only calculate an improvement when the supplied comparison marks the benchmark metrics comparable.

If the context's "executionPlan" has an "actualPlan" artifact, that is the database's own real runtime-plan evidence - the SQL was actually executed to measure it. Its "source" and "format" identify whether it is database text, XML, or JSON. It is separate from "executionPlan.normalizedPlan", which can remain an *estimate* even when actualPlan is present: treat it as ordinary evidence you may quote or paraphrase in a finding/recommendation's "detail"/"rationale", but do not invent a "planNodeId" from its visual/tree order - that field must only ever reference an id that actually appears in executionPlan.normalizedPlan or planTableMappings. When "aiInput.omittedFields" is present, raw vendor artifacts were deliberately left out only to fit this model's input limit; this is not missing runtime collection. Use the retained structured metrics (especially planTableMappings' actualRows and selectivity values), and do not invent facts from omitted raw content.

If a "CARDINALITY_MISESTIMATE" diagnostic is present, treat it as factual measured evidence that the optimizer estimate needs separate investigation. Distinguish a statistics/cardinality remedy (including correlated predicate columns) from an access-path/index remedy; evaluate both where supported by the context instead of presenting an index as the only explanation.

Before recommending an index or SQL rewrite, review every target table's "physicalHealth" and statistics freshness. Cite relevant observed values such as PostgreSQL dead tuples/modifications since ANALYZE, SQL Server fragmentation and page count, MySQL DATA_FREE, or Oracle CHAIN_CNT. Treat missing, approximate, or potentially stale metrics as missing context rather than proof that maintenance is or is not needed. Do not conflate routine VACUUM, VACUUM FULL, ANALYZE/statistics refresh, SQL Server reorganize/rebuild, MySQL OPTIMIZE TABLE, or Oracle table moves: they have different effects and operational risks. Recommend maintenance only as a candidate for review when the supplied facts support it, and put required workload/locking/freshness information in "missingContext" when it is not supplied.

An index is not always the right fix. If a WHERE/JOIN/GROUP BY predicate wraps a column in a function (e.g. LOWER(col), DATE(col), CAST(col AS ...)), a plain index on that column cannot be used for it at all (the predicate is not sargable) - in that case, prefer recommending a sargable rewrite of the predicate itself (for example, rewriting a DATE(created_at) = X range check as created_at >= X AND created_at < X + one day) as the primary recommendation, and only add a supporting index once the predicate is sargable. Do not recommend an index on a function-wrapped column (e.g. CREATE INDEX ... (LOWER(col))) without first checking its selectivity per the next paragraph.

When a recommendation rewrites the target SQL, its "suggestedQuery" is required. It must be a complete, standalone, executable replacement statement: retain the target statement's SELECT/INSERT/UPDATE/DELETE form and every unaffected FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, and locking clause. Change only what the recommendation requires. Never put only a predicate, a clause fragment, an ellipsis, or pseudocode in "suggestedQuery". Omit "suggestedQuery" only when the recommendation has no executable SQL (for example, a workload review or a request for missing information).

Before returning a rewrite recommendation, compare its complete "suggestedQuery" with the current "statement.sql", not the baseline SQL. Never recommend a rewrite that the current SQL has already applied, and never return "suggestedQuery" that is equivalent to the current SQL; describe an already-applied baseline-to-current rewrite as an observed improvement instead.

Before recommending an index, distinguish the two independent metrics on the relevant "planTableMappings" entry: "tableAccessFraction" is the table-access candidate set relative to the whole table, while "predicateFilterSelectivity" is the pass rate of a local Filter after that access. Never call one evidence for the other, and never invent either metric when absent. A non-covering index on a predicate matching roughly 20% or more of a table's rows is often ignored by the query optimizer, or can make performance worse than a full scan. State the specific metric and figure you used explicitly in the recommendation's "rationale".

Before finalizing any CREATE INDEX in "suggestedQuery", check "tables[].definition.indexes" for the target table and do not propose an index whose column set already exists verbatim - that is a wasted, sometimes outright invalid, suggestion.

When proposing a composite index, place equality-condition columns before range-condition columns (for example, for WHERE status = 'X' AND created_at > Y, prefer (status, created_at), not (created_at, status)).

Before proposing a composite index, first enumerate every column that appears in the target SQL's WHERE clause and JOIN ... ON conditions for that table - do not stop after the first column you notice, even if a diagnostic drew your attention to one specific column. A "PLAN_OBSERVATION" diagnostic (for example, temporary table or filesort usage) describes a symptom of a GROUP BY/ORDER BY, not necessarily the dominant cost of the query - check "executionPlan.dominantCostPlanNode" (a purely factual pointer at whichever plan node accounts for the most cost/time, with no severity or judgment attached) to see which plan node actually dominates before deciding which columns matter most, rather than anchoring on whichever diagnostic happens to sit near a familiar-looking node.`;

const RESPONSE_FORMAT_INSTRUCTIONS = `Format the response stringified with JSON.stringify. Do not enclose the JSON string in \`\`\`json ~ \`\`\` code fences.

The response must be a single JSON object with exactly this shape:
{
  "summary": "1-3 sentence plain-language summary of the overall finding.",
  "findings": [
    {
      "title": "short title",
      "detail": "explanation, referencing specific facts from the context",
      "severity": "info" | "warning" | "critical",
      "evidence": {
        "schemaName": "optional",
        "tableName": "optional",
        "indexName": "optional",
        "planNodeId": "optional, must match an id from executionPlan.normalizedPlan or planTableMappings in the context",
        "diagnosticCode": "optional, must match a code from collection.diagnostics in the context"
      }
    }
  ],
  "recommendations": [
    {
      "title": "short title",
      "detail": "what to change",
      "rationale": "why this should help, referencing specific facts from the context",
      "riskLevel": "low" | "medium" | "high",
      "suggestedQuery": "required for an SQL rewrite; then a complete standalone replacement statement, never a clause fragment. Otherwise optional executable SQL (e.g. a candidate CREATE INDEX statement); omit only when no SQL is applicable",
      "evidence": { "...": "same shape as above, all optional" }
    }
  ],
  "confidence": "low" | "medium" | "high",
  "missingContext": ["plain-language description of what additional information would improve confidence"]
}

"evidence" on a finding or recommendation is entirely optional - include it only when you can point at a specific schemaName/tableName/indexName/planNodeId/diagnosticCode that actually appears in the context provided below, so the user can cross-check your reasoning against the raw data. Never fabricate an evidence reference that does not appear in the context.

If "findings" is empty, explain why in "summary" (for example, nothing actionable was found). "missingContext" should be an empty array if nothing is missing.`;

// External AI copy uses the same domain guidance, but requests plain text
// because no response parser is involved.
const PLAIN_TEXT_RESPONSE_INSTRUCTIONS = `Answer in plain, well-organized text for a human reader - not JSON, and not wrapped in a code fence (except for actual SQL you are suggesting the user run).

Structure your answer as:
- A short summary of what is likely causing the slowness.
- Findings: the specific, evidence-based facts from the context that support that summary.
- Recommendations: concrete changes to make, each with a complete SQL statement to run where applicable (e.g. a full CREATE INDEX statement, or the fully rewritten query) - not just a description of the change.

If nothing actionable was found, say so plainly instead of forcing a recommendation.`;

export type PerformanceTuningAiPrompt = {
  assistant: string;
  user: string;
};

export type BuildAiAnalysisPromptOptions = {
  // Mirrors the other AI panels' translateResponse flag, but placed
  // in the *assistant* prompt (not appended to the user prompt like those
  // two) and scoped to specific fields - PerformanceTuningAiAnalysisResult is
  // strict JSON with literal-union enum fields (severity/confidence/
  // riskLevel) that the Vue panel class-binds on for its color coding; a
  // blanket "translate your response" instruction risks the model
  // translating those enum values too and silently breaking that rendering.
  // `language` is passed in (typically env.language) rather than read from
  // `vscode` here, so this file stays free of any vscode import and fully
  // unit-testable.
  translateResponse?: boolean;
  language?: string;
  // The model-specific sending path selects compact only after it has
  // measured the full prompt against LanguageModelChat.maxInputTokens.
  // Full is deliberately the default so saved Notebooks and manual-copy
  // prompts retain the complete, reproducible database artifact.
  contextDetail?: "full" | "compact";
  // Baseline comparison (comparison implementation plan §13.1). Already
  // projected down by buildComparisonAiInput() - this file never receives,
  // and therefore can never send, the baseline's whole Full Context.
  comparison?: ComparisonAiInput;
};

/**
 * Creates an AI-only projection for a model with a smaller input window.
 * It never mutates the collected context: Full Context JSON, panel display,
 * and saved notebooks keep exact artifacts. The omitted SQL Server XML is
 * safe to remove here because its table-level runtime facts have already
 * been resolved into planTableMappings by db-drivers; the same conservative
 * fallback also works for another vendor's oversized artifact by leaving
 * its source/format visible and explicitly declaring the omission.
 */
export function buildCompactAiAnalysisContext(context: PerformanceTuningContext): Record<string, unknown> {
  const { vendorPlan: _vendorPlan, actualPlan, ...executionPlan } = context.executionPlan;
  return {
    ...context,
    executionPlan: {
      ...executionPlan,
      ...(actualPlan
        ? {
            actualPlan: {
              source: actualPlan.source,
              format: actualPlan.format,
              contentOmittedFromAiInput: true,
            },
          }
        : {}),
    },
    aiInput: {
      detail: "compact",
      omittedFields: [
        ...(actualPlan ? ["executionPlan.actualPlan.content"] : []),
        "executionPlan.vendorPlan",
      ],
      omissionReason: "Raw vendor artifacts were omitted to fit the selected language model's input limit.",
    },
  };
}

// Shared by buildAiAnalysisPrompt() (the "user" half of its {assistant, user}
// split) and buildPlainTextAnalysisPrompt() (folded into one combined
// string, since a manual copy/paste has no separate system-message
// channel) - identical content either way, just assembled differently.
function buildContextSection(
  context: PerformanceTuningContext,
  contextForAi: unknown = context,
  comparison?: ComparisonAiInput
): string {
  const contextJson = JSON.stringify(contextForAi, null, 2);

  const dmlSafety = context.statement.analyzeEligibility?.allowed === false
    ? [
        "# DML execution safety",
        "",
        "This statement is not eligible for Explain Analyze and its context is estimate-only. Do not recommend running Explain Analyze, collecting an actual plan, or executing this statement. If runtime validation is needed, state that it must use a separately approved staging/test workflow. Any SQL in your response is illustrative only.",
        "",
      ]
    : [];
  return [
    "Analyze the performance of the following SQL statement using the structured context collected below.",
    "",
    "This context was collected by Database Notebook's getPerformanceTuningContext() and contains the exact SQL, table/index definitions, and query predicates as read from the database - it has not been masked or redacted, and may contain literal values from the original query. Treat it accordingly.",
    "",
    "# Target SQL statement",
    "",
    "```sql",
    context.statement.sql,
    "```",
    "",
    ...dmlSafety,
    "# Performance tuning context (JSON)",
    "",
    "```json",
    contextJson,
    "```",
    "",
    // Appended after the Current context, so the model reads what is on
    // screen now first and the comparison as commentary on it (§13.1).
    ...(comparison
      ? [
          "# Comparison input (JSON)",
          "",
          "```json",
          JSON.stringify(comparison, null, 2),
          "```",
          "",
        ]
      : []),
  ].join("\n");
}

export function buildAiAnalysisPrompt(
  context: PerformanceTuningContext,
  options: BuildAiAnalysisPromptOptions = {}
): PerformanceTuningAiPrompt {
  const assistantParts = [ASSISTANT_ANALYSIS_PROMPT];
  if (options.comparison) {
    assistantParts.push("", buildComparisonInstructions("rdb"));
  }
  assistantParts.push("", RESPONSE_FORMAT_INSTRUCTIONS);
  if (options.translateResponse && options.language) {
    assistantParts.push(
      "",
      `Write "summary", each finding's "title" and "detail", each recommendation's "title", "detail", and ` +
        `"rationale", and each "missingContext" entry in the following language: ${options.language}. Do not ` +
        `translate JSON field names, the fixed English values of "severity"/"confidence"/"riskLevel", ` +
        `"suggestedQuery" (it is SQL code), or any evidence identifier (schemaName/tableName/indexName/` +
        `planNodeId/diagnosticCode) - leave those in English/unchanged.`
    );
  }
  const assistant = [...assistantParts, ""].join("\n");

  const contextForAi = options.contextDetail === "compact" ? buildCompactAiAnalysisContext(context) : context;
  return {
    assistant,
    user: buildContextSection(context, contextForAi, options.comparison),
  };
}

// "Copy Prompt for Other AI" toolbar action (PerformanceTuningPreviewPanel.ts) -
// one combined, self-contained string meant for a manual paste into an
// external AI chat (ChatGPT, Claude.ai, Claude Code, Codex, ...), not a
// vscode.lm call. See PLAIN_TEXT_RESPONSE_INSTRUCTIONS's own doc comment for
// why the domain guidance is reused as-is and only the response-format
// instructions differ. It accepts the same translate/language selection as
// the Copilot path, but phrases it for human-readable prose rather than the
// JSON fields used by buildAiAnalysisPrompt().
export function buildPlainTextAnalysisPrompt(
  context: PerformanceTuningContext,
  options: Pick<BuildAiAnalysisPromptOptions, "translateResponse" | "language" | "comparison"> = {}
): string {
  const translationInstruction = options.translateResponse && options.language
    ? `Answer all human-readable prose in the following language: ${options.language}. Do not translate SQL code, database identifiers, or evidence identifiers.`
    : undefined;
  return [
    ASSISTANT_ANALYSIS_PROMPT,
    // The external-AI path gets the same Comparison Input and the same
    // instructions as the Copilot path, so the two are analyzing under
    // identical conditions - §13.2 rules out concatenating two full contexts
    // here just because there is no token limit to respect.
    ...(options.comparison ? ["", buildComparisonInstructions("rdb")] : []),
    "",
    PLAIN_TEXT_RESPONSE_INSTRUCTIONS,
    ...(translationInstruction ? ["", translationInstruction] : []),
    "",
    buildContextSection(context, context, options.comparison),
  ].join("\n");
}
