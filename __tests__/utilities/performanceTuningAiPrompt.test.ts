import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { buildAiAnalysisPrompt } from "../../src/utilities/performanceTuningAiPrompt";

function buildContext(overrides: Partial<PerformanceTuningContext> = {}): PerformanceTuningContext {
  return {
    formatVersion: 1,
    database: { vendor: "postgresql", databaseName: "app" },
    statement: { sql: "SELECT * FROM orders WHERE tenant_id = 42", source: "editor" },
    executionPlan: { mode: "estimate", format: "json" },
    tables: [],
    planTableMappings: [],
    collection: { collectedAt: "2026-08-18T00:00:00.000Z", status: "complete", diagnostics: [], unavailableSections: [] },
    ...overrides,
  };
}

describe("buildAiAnalysisPrompt", () => {
  it("includes the target SQL in the user prompt", () => {
    const { user } = buildAiAnalysisPrompt(buildContext());
    expect(user).toContain("SELECT * FROM orders WHERE tenant_id = 42");
  });

  it("includes the full context JSON verbatim, without summarizing or truncating it", () => {
    const context = buildContext({
      database: { vendor: "postgresql", databaseName: "app", schemaName: "public" },
    });
    const { user } = buildAiAnalysisPrompt(context);
    expect(user).toContain(JSON.stringify(context, null, 2));
  });

  it("does not mask literals in the SQL or context (matches §9.2's no-masking policy)", () => {
    const context = buildContext({
      statement: { sql: "SELECT * FROM customers WHERE email = 'someone@example.com'", source: "editor" },
    });
    const { user } = buildAiAnalysisPrompt(context);
    expect(user).toContain("someone@example.com");
  });

  it("instructs the model to reply with the expected JSON shape and not fabricate evidence", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant).toContain('"summary"');
    expect(assistant).toContain('"findings"');
    expect(assistant).toContain('"recommendations"');
    expect(assistant).toContain('"confidence"');
    expect(assistant).toContain('"missingContext"');
    expect(assistant).toContain("Never fabricate an evidence reference");
    expect(assistant.toLowerCase()).toContain("do not invent statistics");
  });

  it("instructs the model never to suggest running SQL automatically", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant.toLowerCase()).toContain("do not suggest that you or the user should run any sql automatically");
  });

  it("explains executionPlan.actualPlanText (MySQL's unparsed EXPLAIN ANALYZE text) so it isn't mistaken for the normalized plan", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant).toContain("actualPlanText");
    expect(assistant.toLowerCase()).toContain("unparsed");
    // planNodeId evidence only makes sense against the normalized plan tree -
    // the prompt must not imply actualPlanText's own lines can be cited that way.
    expect(assistant).toContain("planNodeId");
  });

  // 2026-08-21 follow-up (scripts/performance-lab/aiResults/summary.md's
  // re-examined improvement proposals, db-drivers repo) - one assertion per
  // added instruction.
  it("instructs the model to prefer a sargable SQL rewrite over indexing a function-wrapped predicate column", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant.toLowerCase()).toContain("sargable");
    expect(assistant).toContain("LOWER(col)");
  });

  it("instructs the model to self-verify selectivity via filterSelectivity before recommending an index", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant).toContain("filterSelectivity");
    expect(assistant).toContain("rationale");
  });

  it("instructs the model to check tables[].definition.indexes for an existing duplicate before finalizing a CREATE INDEX", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant).toContain("tables[].definition.indexes");
    expect(assistant).toContain("CREATE INDEX");
  });

  it("instructs the model to place equality-condition columns before range-condition columns in a composite index", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant.toLowerCase()).toContain("equality-condition columns before range-condition columns");
  });

  it("instructs the model to enumerate all WHERE/JOIN columns and check dominantCostPlanNode rather than anchoring on a nearby diagnostic", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext());
    expect(assistant).toContain("dominantCostPlanNode");
    expect(assistant).toContain("PLAN_OBSERVATION");
  });

  it("adds a translate instruction naming the language when translateResponse and language are both given", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext(), {
      translateResponse: true,
      language: "ja",
    });
    expect(assistant).toContain("following language: ja");
    expect(assistant).toContain('Do not translate JSON field names, the fixed English values of "severity"');
    expect(assistant).toContain("suggestedSql");
    expect(assistant).toContain("evidence identifier");
  });

  it("does not add a translate instruction when translateResponse is false", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext(), { translateResponse: false, language: "ja" });
    expect(assistant).not.toContain("following language");
  });

  it("does not add a translate instruction when translateResponse is true but language is missing", () => {
    const { assistant } = buildAiAnalysisPrompt(buildContext(), { translateResponse: true });
    expect(assistant).not.toContain("following language");
  });

  it("omitting options entirely behaves exactly like translateResponse: false (no instruction, prompt unchanged)", () => {
    const withNoOptions = buildAiAnalysisPrompt(buildContext());
    const withExplicitFalse = buildAiAnalysisPrompt(buildContext(), {});
    expect(withNoOptions.assistant).toBe(withExplicitFalse.assistant);
    expect(withNoOptions.assistant).not.toContain("following language");
  });
});
