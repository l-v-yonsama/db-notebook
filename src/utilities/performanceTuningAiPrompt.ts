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

If the context's "executionPlan" has an "actualPlanText" field, that is the database's own real EXPLAIN ANALYZE output (currently MySQL only) - the SQL was actually executed to measure it, and it contains real per-step timing/row counts. It is supplied as plain, unparsed text, separate from "executionPlan.normalizedPlan" (which stays an *estimate* even when actualPlanText is present): treat every line in it as ordinary text evidence you may quote or paraphrase in a finding/recommendation's "detail"/"rationale", but do not invent a "planNodeId" for any of it - that field must only ever reference an id that actually appears in executionPlan.normalizedPlan or planTableMappings.`;

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

  // No summarization/truncation here (§7): RDSBaseDriver.enforcePayloadBudget()
  // has already shaped this JSON to fit maxPayloadBytes, and re-summarizing on
  // top of that would discard the very evidence findings/recommendations are
  // supposed to reference.
  const contextJson = JSON.stringify(context, null, 2);

  const user = [
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

  return { assistant, user };
}
