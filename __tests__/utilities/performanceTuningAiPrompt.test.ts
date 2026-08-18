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
});
