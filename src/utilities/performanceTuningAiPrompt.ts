import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";

// Builds the {assistant, user} prompt pair for Step 10's "Analyze with AI"
// flow (misc/design/performance-tuning-structured-ai-analysis-plan.ja.md §7).
// Pure/deterministic - no vscode.lm call happens here, so this is unit
// testable without a language model. Mirrors lmUtil.ts's createPrompt()
// {assistant, user} split (the existing SQL-annotation AI feature).

const ASSISTANT_ANALYSIS_PROMPT = `You are a database performance tuning expert.
Your job is to analyze the structured performance tuning context supplied by the user - an execution plan, related table definitions, optimizer statistics, physical health metrics, and structured collection diagnostics - and explain why the target SQL statement may be slow, then suggest safe, verifiable improvements.

Base every finding and recommendation only on the information given in the context below. Do not invent statistics, row counts, index names, or table names that are not present in it. If the context is missing information you would need for a more confident answer (for example, an actual/ANALYZE plan, or statistics for a specific table), say so in "missingContext" instead of guessing.

Never claim a recommendation is guaranteed to work: this is one point-in-time context snapshot, not a live benchmark, and the user must verify and apply any change themselves - do not suggest that you or the user should run any SQL automatically as part of this analysis.

If the context's "executionPlan" has an "actualPlan" artifact, that is the database's own real runtime-plan evidence - the SQL was actually executed to measure it. Its "source" and "format" identify whether it is database text, XML, or JSON. It is separate from "executionPlan.normalizedPlan", which can remain an *estimate* even when actualPlan is present: treat it as ordinary evidence you may quote or paraphrase in a finding/recommendation's "detail"/"rationale", but do not invent a "planNodeId" from its visual/tree order - that field must only ever reference an id that actually appears in executionPlan.normalizedPlan or planTableMappings.

An index is not always the right fix. If a WHERE/JOIN/GROUP BY predicate wraps a column in a function (e.g. LOWER(col), DATE(col), CAST(col AS ...)), a plain index on that column cannot be used for it at all (the predicate is not sargable) - in that case, prefer recommending a sargable rewrite of the predicate itself (for example, rewriting a DATE(created_at) = X range check as created_at >= X AND created_at < X + one day) as the primary recommendation, and only add a supporting index once the predicate is sargable. Do not recommend an index on a function-wrapped column (e.g. CREATE INDEX ... (LOWER(col))) without first checking its selectivity per the next paragraph.

Before recommending an index, check "filterSelectivity" on the relevant "planTableMappings" entry for that table (or, if it is absent, estimate it yourself from "tables[].statistics.columns[].distinctCount"/"distinctFraction" and "tables[].statistics.estimatedRowCount"). A non-covering index on a predicate matching roughly 20% or more of a table's rows is often ignored by the query optimizer, or can make performance worse than a full scan. State the selectivity figure you used explicitly in the recommendation's "rationale".

Before finalizing any CREATE INDEX in "suggestedSql", check "tables[].definition.indexes" for the target table and do not propose an index whose column set already exists verbatim - that is a wasted, sometimes outright invalid, suggestion.

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
      "suggestedSql": "optional illustrative SQL (e.g. a candidate CREATE INDEX statement); omit if not applicable",
      "evidence": { "...": "same shape as above, all optional" }
    }
  ],
  "confidence": "low" | "medium" | "high",
  "missingContext": ["plain-language description of what additional information would improve confidence"]
}

"evidence" on a finding or recommendation is entirely optional - include it only when you can point at a specific schemaName/tableName/indexName/planNodeId/diagnosticCode that actually appears in the context provided below, so the user can cross-check your reasoning against the raw data. Never fabricate an evidence reference that does not appear in the context.

If "findings" is empty, explain why in "summary" (for example, nothing actionable was found). "missingContext" should be an empty array if nothing is missing.`;

// "Copy Prompt for Other AI" (2026-08-21 follow-up): a fallback for a user
// whose vscode.lm-exposed models are too limited for good results (today
// that's `vendor: "copilot"` only - see PerformanceTuningPreviewPanel.ts),
// but who already has a paid ChatGPT/Claude/Codex/Claude Code subscription
// they'd rather use directly, outside VS Code entirely. Reuses
// ASSISTANT_ANALYSIS_PROMPT verbatim - none of that domain guidance
// (sargable rewrites, selectivity checks, duplicate-index avoidance,
// composite column order, WHERE-clause enumeration) is Copilot-specific -
// and only swaps RESPONSE_FORMAT_INSTRUCTIONS' strict JSON contract for a
// plain-text one, since there is no parser on the other end of a manual
// copy/paste: the user reads the answer directly wherever they pasted it.
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
  // Mirrors Chat2QueryPanel.ts/lmUtil.ts's translateResponse flag, but placed
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
};

// Shared by buildAiAnalysisPrompt() (the "user" half of its {assistant, user}
// split) and buildPlainTextAnalysisPrompt() (folded into one combined
// string, since a manual copy/paste has no separate system-message
// channel) - identical content either way, just assembled differently.
function buildContextSection(context: PerformanceTuningContext): string {
  // No summarization/truncation here (§7): RDSBaseDriver.enforcePayloadBudget()
  // has already shaped this JSON to fit maxPayloadBytes, and re-summarizing on
  // top of that would discard the very evidence findings/recommendations are
  // supposed to reference.
  const contextJson = JSON.stringify(context, null, 2);

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
    "# Performance tuning context (JSON)",
    "",
    "```json",
    contextJson,
    "```",
    "",
  ].join("\n");
}

export function buildAiAnalysisPrompt(
  context: PerformanceTuningContext,
  options: BuildAiAnalysisPromptOptions = {}
): PerformanceTuningAiPrompt {
  const assistantParts = [ASSISTANT_ANALYSIS_PROMPT, "", RESPONSE_FORMAT_INSTRUCTIONS];
  if (options.translateResponse && options.language) {
    assistantParts.push(
      "",
      `Write "summary", each finding's "title" and "detail", each recommendation's "title", "detail", and ` +
        `"rationale", and each "missingContext" entry in the following language: ${options.language}. Do not ` +
        `translate JSON field names, the fixed English values of "severity"/"confidence"/"riskLevel", ` +
        `"suggestedSql" (it is SQL code), or any evidence identifier (schemaName/tableName/indexName/` +
        `planNodeId/diagnosticCode) - leave those in English/unchanged.`
    );
  }
  const assistant = [...assistantParts, ""].join("\n");

  return { assistant, user: buildContextSection(context) };
}

// "Copy Prompt for Other AI" toolbar action (PerformanceTuningPreviewPanel.ts) -
// one combined, self-contained string meant for a manual paste into an
// external AI chat (ChatGPT, Claude.ai, Claude Code, Codex, ...), not a
// vscode.lm call. See PLAIN_TEXT_RESPONSE_INSTRUCTIONS's own doc comment for
// why the domain guidance is reused as-is and only the response-format
// instructions differ. No translateResponse option (unlike
// buildAiAnalysisPrompt()) - the user is pasting into a live chat they can
// just ask a follow-up in their own language if wanted, and there is no
// enum-valued JSON here for a translation instruction to risk corrupting.
export function buildPlainTextAnalysisPrompt(context: PerformanceTuningContext): string {
  return [
    ASSISTANT_ANALYSIS_PROMPT,
    "",
    PLAIN_TEXT_RESPONSE_INSTRUCTIONS,
    "",
    buildContextSection(context),
  ].join("\n");
}
