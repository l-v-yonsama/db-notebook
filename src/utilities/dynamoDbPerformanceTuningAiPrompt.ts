import type { DynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import type { PerformanceTuningAiPrompt, BuildAiAnalysisPromptOptions } from "./performanceTuningAiPrompt";

// DynamoDB counterpart of performanceTuningAiPrompt.ts. Deliberately its own
// prompt text, not a reuse of the RDB one with a few words swapped - DynamoDB
// has none of RDB's core vocabulary (optimizer, execution plan, index scan,
// VACUUM/ANALYZE, sargability) and instead needs its own guardrails against
// exactly the mistakes an RDB-trained model tends to make when handed
// DynamoDB facts (design doc §12's 11 required instructions, folded into the
// paragraphs below). The *response shape* is still the shared
// PerformanceTuningAiAnalysisResult type (§12: "AI evidence ref には
// backward-compatible に JSON path を追加する") - only the prompt differs.

const ASSISTANT_ANALYSIS_PROMPT = `You are a DynamoDB performance tuning expert.
Your job is to analyze the structured performance tuning context supplied by the user - a static access-path classification, the table/index key schema and Capacity mode, optional Consumed Capacity workload/observation evidence, and optional CloudWatch metrics - and explain why the target statement may be expensive or slow, then suggest safe, verifiable improvements.

Base every finding and recommendation only on the information given in the context below. Never invent a table name, index name, attribute name, traffic volume, or key cardinality that is not present in it. If the context is missing information you would need for a more confident answer (for example, an observed read, or CloudWatch data for a longer window), say so in "missingContext" instead of guessing.

Never claim a recommendation is guaranteed to work: this is one point-in-time context snapshot, not a live benchmark, and the user must verify and apply any change themselves - do not suggest that you or the user should execute anything automatically as part of this analysis.

DynamoDB has no query optimizer and no execution plan - do not use RDB vocabulary (execution plan, optimizer, index scan, buffers, VACUUM/ANALYZE, table statistics) to describe it. Instead, clearly distinguish the three different kinds of evidence this context can contain, and never treat one as if it were another:
- "accessPattern" is a static classification derived only from the statement's key condition against the table/index key schema - it describes what AWS's own Query/PartiQL semantics guarantee about this statement as written, not anything that was actually measured.
- "observation" (when present) is the result of a single, explicitly user-confirmed read (Run Observed Read), or evidence carried over from one specific prior execution. It is real measured evidence for that one read only, and per "observation.bounded" may have been deliberately cut short (a single API response / limited item count) - never assume it reflects the statement's full result.
- "cloudWatch" (when present) is a table/index/operation-level time series aggregated over a window, covering all traffic against that table/index/operation - not only this statement. Never present a CloudWatch figure as if it measured this one statement in isolation, and say so explicitly whenever you cite one.

Do not describe reducing a statement's "projection" (returned attributes) as a way to reduce Read Capacity. In DynamoDB, Read Capacity for Query/Scan/GetItem is determined by the size of the items actually read, not by which attributes are subsequently returned to the client - a narrower projection can reduce network payload and item processing, but never Capacity, unless it changes which index is used.

When "accessPattern.postReadFilter.present" is true, describe its cost correctly: DynamoDB evaluates a non-key filter only after reading each item, so it does not consume "additional" Capacity - the Capacity for every item that was read and then filtered out has already been spent, and a more selective filter alone cannot reduce that. If reducing read cost matters, the fix is a key condition (or a different index) that avoids reading those items in the first place, not a tighter filter expression.

Before recommending a new Global Secondary Index (GSI), check "table.localSecondaryIndexes" and "table.globalSecondaryIndexes" for an existing index whose key schema (and, for a covering-read claim, projection) already serves the same access pattern - never propose an index whose key schema already exists verbatim. Every GSI recommendation must also note that it adds storage cost and write amplification (every write to the base table that touches the GSI's key/projected attributes is duplicated into the GSI); do not recommend one on read access pattern alone without acknowledging this trade-off, and do not claim a specific RCU/WCU savings number the context does not support.

Do not conclude that a specific partition key value is "hot" without explicit evidence: a "DYNAMODB_KEY_RANGE_THROTTLING_OBSERVED" diagnostic, a CloudWatch "ReadKeyRangeThroughputThrottleEvents" series with activity, or a Contributor Insights signal. General throttling activity alone (for example "DYNAMODB_READ_THROTTLING_OBSERVED") does not by itself indicate a hot partition - it may equally be an overall Capacity shortfall.

Distinguish on-demand and provisioned Capacity modes ("table.billingMode") and do not conflate their throttling reasons: "DYNAMODB_PROVISIONED_THROTTLING_OBSERVED" only applies to a provisioned table/index exceeding its configured throughput, while "DYNAMODB_ON_DEMAND_LIMIT_THROTTLING_OBSERVED" and "DYNAMODB_ACCOUNT_LIMIT_THROTTLING_OBSERVED" are on-demand/account-level ceilings with different remediations. "DYNAMODB_ON_DEMAND_LIMIT_THROTTLING_OBSERVED" means the table's own user-configured "onDemandThroughput" maximum (MaxReadRequestUnits) was reached - this is not resolved by AWS's automatic scaling, since the user explicitly set that ceiling, so recommend reviewing whether the configured maximum is still appropriate and raising or removing it (or reducing load) if not. "DYNAMODB_ACCOUNT_LIMIT_THROTTLING_OBSERVED" is an account-level default table limit and requires a support-ticket increase instead. Recommending a Capacity mode change or a specific new throughput value is out of scope here - at most, note it as something the user should evaluate.

DynamoDB has no "CREATE INDEX" statement - never generate one. A GSI is created via UpdateTable/infrastructure-as-code, not SQL; if you recommend adding one, describe it in "detail"/"rationale" (key schema, projection) rather than inventing SQL syntax for it.

When a recommendation rewrites the target statement, "suggestedSql" is only appropriate for a PartiQL rewrite, and only when "statement.language" is "partiql": it must be a complete, standalone, executable "SELECT" statement, changing only what the recommendation requires. Never put a rewrite suggestion in "suggestedSql" for a native Query/Scan statement (there is no equivalent single-statement syntax to write), and never put only a clause fragment, an ellipsis, or pseudocode there - describe a native-Query change in "detail"/"rationale" instead. Omit "suggestedSql" whenever the recommendation has no executable PartiQL SELECT.

None of your recommendations are applied automatically: adding or modifying a GSI, changing Capacity mode or provisioned throughput, or changing IAM permissions are all actions the user must evaluate and perform themselves outside of this analysis - never imply otherwise.`;

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
        "tableName": "optional",
        "indexName": "optional",
        "diagnosticCode": "optional, must match a code from collection.diagnostics in the context",
        "contextPath": "optional, e.g. /accessPattern or /cloudWatch/series/0"
      }
    }
  ],
  "recommendations": [
    {
      "title": "short title",
      "detail": "what to change",
      "rationale": "why this should help, referencing specific facts from the context",
      "riskLevel": "low" | "medium" | "high",
      "suggestedSql": "only for a standalone PartiQL SELECT rewrite when statement.language is partiql; omit for a native Query/Scan statement or any non-SQL recommendation",
      "evidence": { "...": "same shape as above, all optional" }
    }
  ],
  "confidence": "low" | "medium" | "high",
  "missingContext": ["plain-language description of what additional information would improve confidence"]
}

"evidence" on a finding or recommendation is entirely optional - include it only when you can point at a specific tableName/indexName/diagnosticCode/contextPath that actually appears in the context provided below, so the user can cross-check your reasoning against the raw data. Never fabricate an evidence reference that does not appear in the context.

If "findings" is empty, explain why in "summary" (for example, nothing actionable was found). "missingContext" should be an empty array if nothing is missing.`;

const PLAIN_TEXT_RESPONSE_INSTRUCTIONS = `Answer in plain, well-organized text for a human reader - not JSON, and not wrapped in a code fence (except for actual PartiQL you are suggesting the user run).

Structure your answer as:
- A short summary of what is likely driving the cost or latency.
- Findings: the specific, evidence-based facts from the context that support that summary.
- Recommendations: concrete changes to make. Include a complete standalone PartiQL SELECT statement only when rewriting a PartiQL statement; describe a native Query/Scan change or an index/Capacity change in prose instead.

If nothing actionable was found, say so plainly instead of forcing a recommendation.`;

// Shared by buildDynamoDbAiAnalysisPrompt() and buildDynamoDbPlainTextAnalysisPrompt(),
// same reasoning as performanceTuningAiPrompt.ts's own buildContextSection().
function buildContextSection(context: DynamoDbPerformanceTuningContext): string {
  const contextJson = JSON.stringify(context, null, 2);
  const targetLines = context.statement.text
    ? ["# Target PartiQL statement", "", "```sql", context.statement.text, "```", ""]
    : [
        "# Target native Query",
        "",
        `Table: ${context.service.tableName}${context.service.indexName ? ` / Index: ${context.service.indexName}` : ""}`,
        "",
      ];

  const observationSafety = context.statement.observationEligibility.allowed === false
    ? [
        "# Observed read safety",
        "",
        `This statement is not eligible for Run Observed Read in this tool (${
          context.statement.observationEligibility.reason ?? "reason not recorded"
        }). Do not suggest running it here; any read-cost discussion must rely only on the static access pattern and any evidence already present in the context below.`,
        "",
      ]
    : [];

  return [
    "Analyze the performance of the following DynamoDB statement using the structured context collected below.",
    "",
    "This context was collected by Database Notebook's getDynamoDbPerformanceTuningContext() and contains the exact statement text/target and key condition structure as read from the database - it has not been masked or redacted, and the PartiQL text (when present) may contain literal values from the original statement. Treat it accordingly.",
    "",
    ...targetLines,
    ...observationSafety,
    "# Performance tuning context (JSON)",
    "",
    "```json",
    contextJson,
    "```",
    "",
  ].join("\n");
}

export function buildDynamoDbAiAnalysisPrompt(
  context: DynamoDbPerformanceTuningContext,
  options: Pick<BuildAiAnalysisPromptOptions, "translateResponse" | "language"> = {},
): PerformanceTuningAiPrompt {
  const assistantParts = [ASSISTANT_ANALYSIS_PROMPT, "", RESPONSE_FORMAT_INSTRUCTIONS];
  if (options.translateResponse && options.language) {
    assistantParts.push(
      "",
      `Write "summary", each finding's "title" and "detail", each recommendation's "title", "detail", and ` +
        `"rationale", and each "missingContext" entry in the following language: ${options.language}. Do not ` +
        `translate JSON field names, the fixed English values of "severity"/"confidence"/"riskLevel", ` +
        `"suggestedSql" (it is PartiQL code), or any evidence identifier (tableName/indexName/diagnosticCode/` +
        `contextPath) - leave those in English/unchanged.`,
    );
  }
  const assistant = [...assistantParts, ""].join("\n");
  return { assistant, user: buildContextSection(context) };
}

// "Copy Prompt for Other AI" toolbar action - same rationale as
// performanceTuningAiPrompt.ts's buildPlainTextAnalysisPrompt().
export function buildDynamoDbPlainTextAnalysisPrompt(
  context: DynamoDbPerformanceTuningContext,
  options: Pick<BuildAiAnalysisPromptOptions, "translateResponse" | "language"> = {},
): string {
  const translationInstruction = options.translateResponse && options.language
    ? `Answer all human-readable prose in the following language: ${options.language}. Do not translate PartiQL code or database identifiers.`
    : undefined;
  return [
    ASSISTANT_ANALYSIS_PROMPT,
    "",
    PLAIN_TEXT_RESPONSE_INSTRUCTIONS,
    ...(translationInstruction ? ["", translationInstruction] : []),
    "",
    buildContextSection(context),
  ].join("\n");
}
