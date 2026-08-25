import type { DynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  buildDynamoDbAiAnalysisPrompt,
  buildDynamoDbPlainTextAnalysisPrompt,
} from "../../src/utilities/dynamoDbPerformanceTuningAiPrompt";

function context(overrides: Partial<DynamoDbPerformanceTuningContext> = {}): DynamoDbPerformanceTuningContext {
  return {
    formatVersion: 1,
    engine: "dynamodb",
    service: { provider: "AWS", service: "DynamoDB", endpointKind: "aws", tableName: "orders" },
    statement: {
      language: "partiql",
      text: "SELECT * FROM orders WHERE pk = 'tenant#42'",
      source: "editor",
      kind: "select",
      observationEligibility: { allowed: true },
    },
    accessPattern: {
      operation: "PartiQLSelect",
      accessPath: "tableQuery",
      confidence: "certain",
      tableName: "orders",
      partitionKey: { attributeName: "pk", operator: "=", conditionPresent: true },
      postReadFilter: { present: false, attributes: [] },
      projection: { allAttributes: true, attributes: [] },
      consistentRead: "eventual",
    },
    table: {
      tableName: "orders",
      billingMode: "PAY_PER_REQUEST",
      keySchema: { partitionKey: { attributeName: "pk", attributeType: "S" } },
      attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
      localSecondaryIndexes: [],
      globalSecondaryIndexes: [],
      contributorInsights: [],
    },
    collection: { collectedAt: "2026-08-24T00:00:00.000Z", status: "complete", diagnostics: [], unavailableSections: [] },
    ...overrides,
  };
}

describe("buildDynamoDbAiAnalysisPrompt", () => {
  it("includes the target PartiQL statement and the full context JSON verbatim", () => {
    const value = context();
    const { user } = buildDynamoDbAiAnalysisPrompt(value);
    expect(user).toContain("SELECT * FROM orders WHERE pk = 'tenant#42'");
    expect(user).toContain(JSON.stringify(value, null, 2));
  });

  it("does not mask literals in the statement text (matches the RDB no-masking policy)", () => {
    const value = context({
      statement: {
        language: "partiql",
        text: "SELECT * FROM customers WHERE email = 'someone@example.com'",
        source: "editor",
        kind: "select",
        observationEligibility: { allowed: true },
      },
    });
    expect(buildDynamoDbAiAnalysisPrompt(value).user).toContain("someone@example.com");
  });

  it("shows the table/index instead of a SQL fence for a native Query statement with no text", () => {
    const value = context({
      statement: {
        language: "dynamodb-query",
        source: "dynamoQueryPanel",
        kind: "query",
        observationEligibility: { allowed: true },
      },
      service: { provider: "AWS", service: "DynamoDB", endpointKind: "aws", tableName: "orders", indexName: "iCountry" },
    });
    const { user } = buildDynamoDbAiAnalysisPrompt(value);
    expect(user).toContain("# Target native Query");
    expect(user).toContain("Table: orders");
    expect(user).toContain("Index: iCountry");
    expect(user).not.toContain("```sql");
  });

  it("adds an observed-read safety note and the reason when the statement is not eligible", () => {
    const value = context({
      statement: {
        language: "partiql",
        text: "SELECT * FROM orders WHERE pk = ?",
        source: "sqlHistory",
        kind: "select",
        observationEligibility: { allowed: false, reason: "The statement contains an unresolved bind marker (?)." },
      },
    });
    const { user } = buildDynamoDbAiAnalysisPrompt(value);
    expect(user).toContain("# Observed read safety");
    expect(user).toContain("unresolved bind marker");
    expect(user).toContain("Do not suggest running it here");
  });

  it("omits the observed-read safety note when the statement is eligible", () => {
    const { user } = buildDynamoDbAiAnalysisPrompt(context());
    expect(user).not.toContain("# Observed read safety");
  });

  it("instructs the model to reply with the expected JSON shape", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain('"summary"');
    expect(assistant).toContain('"findings"');
    expect(assistant).toContain('"recommendations"');
    expect(assistant).toContain('"confidence"');
    expect(assistant).toContain('"missingContext"');
    expect(assistant).toContain('"contextPath"');
    expect(assistant).toContain("Never fabricate an evidence reference");
  });

  it("distinguishes static access path, single-request observation, and CloudWatch ambient workload", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain('"accessPattern"');
    expect(assistant).toContain('"observation"');
    expect(assistant.toLowerCase()).toContain("cloudwatch");
    expect(assistant).toContain("not only this statement");
  });

  it("instructs the model never to describe a narrower projection as reducing Read Capacity", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant.toLowerCase()).toContain("do not describe reducing a statement's \"projection\"");
    expect(assistant).toContain("Read Capacity");
  });

  it("instructs the model that a post-read filter does not consume additional Capacity, and already-read items stay charged", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("does not consume \"additional\" Capacity");
    expect(assistant).toContain("already been spent");
  });

  it("instructs the model to check existing LSI/GSI key schema and projection before recommending a new GSI", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("table.localSecondaryIndexes");
    expect(assistant).toContain("table.globalSecondaryIndexes");
    expect(assistant.toLowerCase()).toContain("key schema already exists verbatim");
  });

  it("instructs the model to acknowledge GSI storage cost and write amplification, never a specific savings number", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("storage cost and write amplification");
    expect(assistant).toContain("not claim a specific RCU/WCU savings number");
  });

  it("instructs the model never to conclude a hot partition without explicit evidence", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("DYNAMODB_KEY_RANGE_THROTTLING_OBSERVED");
    expect(assistant).toContain("Contributor Insights");
    expect(assistant.toLowerCase()).toContain("hot");
  });

  it("instructs the model to treat intentionally skipped monitoring as expected scope", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("DYNAMODB_MONITORING_COLLECTION_SKIPPED");
    expect(assistant).toContain("expected analysis scope");
    expect(assistant).toContain("Do not recommend granting CloudWatch/Contributor Insights permissions");
  });

  it("instructs the model not to conflate on-demand/provisioned throttling reasons", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("DYNAMODB_PROVISIONED_THROTTLING_OBSERVED");
    expect(assistant).toContain("DYNAMODB_ON_DEMAND_LIMIT_THROTTLING_OBSERVED");
    expect(assistant).toContain("DYNAMODB_ACCOUNT_LIMIT_THROTTLING_OBSERVED");
  });

  it("explains DYNAMODB_ON_DEMAND_LIMIT_THROTTLING_OBSERVED as a user-configured cap needing review, not something AWS auto-scaling resolves on its own", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("user-configured");
    expect(assistant).toContain("not resolved by AWS's automatic scaling");
    expect(assistant).toContain("raising or removing it");
    expect(assistant).not.toContain("automatic scale-up within minutes");
  });

  it("only allows suggestedSql for a standalone PartiQL rewrite, never a native Query", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("only appropriate for a PartiQL rewrite");
    expect(assistant).toContain("statement.language");
    expect(assistant).toContain("Never put a rewrite suggestion in \"suggestedSql\" for a native Query/Scan statement");
  });

  it("instructs the model never to generate a CREATE INDEX statement", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant).toContain("no \"CREATE INDEX\" statement");
  });

  it("instructs the model that GSI/Capacity/IAM changes are never applied automatically", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context());
    expect(assistant.toLowerCase()).toContain("none of your recommendations are applied automatically");
    expect(assistant).toContain("GSI");
    expect(assistant).toContain("Capacity mode");
    expect(assistant).toContain("IAM");
  });

  it("adds a translate instruction naming the language when translateResponse and language are both given", () => {
    const { assistant } = buildDynamoDbAiAnalysisPrompt(context(), { translateResponse: true, language: "ja" });
    expect(assistant).toContain("following language: ja");
    expect(assistant).toContain("tableName/indexName/diagnosticCode");
  });

  it("does not add a translate instruction when translateResponse is false or language is missing", () => {
    expect(buildDynamoDbAiAnalysisPrompt(context(), { translateResponse: false, language: "ja" }).assistant).not.toContain(
      "following language",
    );
    expect(buildDynamoDbAiAnalysisPrompt(context(), { translateResponse: true }).assistant).not.toContain(
      "following language",
    );
  });
});

describe("buildDynamoDbPlainTextAnalysisPrompt", () => {
  it("returns a single string containing the statement, context JSON, and plain-text response instructions", () => {
    const value = context();
    const prompt = buildDynamoDbPlainTextAnalysisPrompt(value);
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("SELECT * FROM orders WHERE pk = 'tenant#42'");
    expect(prompt).toContain(JSON.stringify(value, null, 2));
    expect(prompt).toContain("plain, well-organized text");
    expect(prompt).not.toContain("JSON.stringify");
  });

  it("adds the requested response language", () => {
    const prompt = buildDynamoDbPlainTextAnalysisPrompt(context(), { translateResponse: true, language: "ja" });
    expect(prompt).toContain("Answer all human-readable prose in the following language: ja.");
  });
});
