import type { DynamoDbAccessPattern } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { buildDynamoDbAccessPatternViewModel } from "../../src/utilities/dynamoDbPerformanceTuningAccessPatternFormatter";

function pattern(overrides: Partial<DynamoDbAccessPattern> = {}): DynamoDbAccessPattern {
  return {
    operation: "Query",
    accessPath: "tableQuery",
    confidence: "certain",
    tableName: "orders",
    partitionKey: { attributeName: "pk", operator: "=", conditionPresent: true },
    postReadFilter: { present: false, attributes: [] },
    projection: { mode: "allAttributes", allAttributes: true, attributes: [] },
    consistentRead: "eventual",
    ...overrides,
  };
}

describe("buildDynamoDbAccessPatternViewModel", () => {
  it("formats a plain table Query with no sort key/index", () => {
    const view = buildDynamoDbAccessPatternViewModel(pattern());
    expect(view).toMatchObject({
      operationLabel: "Query",
      accessPathLabel: "Table Query",
      confidence: "certain",
      targetRef: "orders",
      partitionKeyText: "pk =",
      sortKeyText: undefined,
      postReadFilterText: "None",
      projectionText: "All table attributes",
      consistentReadLabel: "Eventually consistent",
      apiLimitText: undefined,
      resultItemLimitText: undefined,
      scanDirectionLabel: undefined,
    });
  });

  it("formats a partition key with no condition as a full scan", () => {
    const view = buildDynamoDbAccessPatternViewModel(
      pattern({ accessPath: "tableScan", partitionKey: { attributeName: "pk", conditionPresent: false } }),
    );
    expect(view.accessPathLabel).toBe("Table Scan");
    expect(view.partitionKeyText).toBe("pk — no condition (full scan)");
  });

  it("formats a sort key condition and a BETWEEN operator", () => {
    const view = buildDynamoDbAccessPatternViewModel(
      pattern({ sortKey: { attributeName: "createdAt", operator: "BETWEEN", conditionPresent: true } }),
    );
    expect(view.sortKeyText).toBe("createdAt BETWEEN");
  });

  it("formats a sort key attribute with no condition, distinctly from one with a condition", () => {
    const view = buildDynamoDbAccessPatternViewModel(
      pattern({ sortKey: { attributeName: "createdAt", conditionPresent: false } }),
    );
    expect(view.sortKeyText).toBe("createdAt — no condition");
  });

  it("lists post-read filter attributes, and falls back when the parser couldn't resolve them", () => {
    const withAttrs = buildDynamoDbAccessPatternViewModel(
      pattern({ postReadFilter: { present: true, attributes: ["status", "region"] } }),
    );
    expect(withAttrs.postReadFilterText).toBe("status, region");

    const withoutAttrs = buildDynamoDbAccessPatternViewModel(
      pattern({ postReadFilter: { present: true, attributes: [] } }),
    );
    expect(withoutAttrs.postReadFilterText).toBe("Present (attributes not resolved)");
  });

  it("lists projected attributes, and falls back when the parser couldn't resolve them", () => {
    const specific = buildDynamoDbAccessPatternViewModel(
      pattern({ projection: { mode: "specific", allAttributes: false, attributes: ["pk", "total"] } }),
    );
    expect(specific.projectionText).toBe("pk, total");

    const unresolved = buildDynamoDbAccessPatternViewModel(
      pattern({ projection: { mode: "specific", allAttributes: false, attributes: [] } }),
    );
    expect(unresolved.projectionText).toBe("Specific attributes (not resolved)");
  });

  it("distinguishes an index target's default projected attributes from all table attributes", () => {
    const view = buildDynamoDbAccessPatternViewModel(
      pattern({ projection: { mode: "allProjectedAttributes", allAttributes: false, attributes: [] } }),
    );
    expect(view.projectionText).toBe("All projected index attributes");
  });

  it("includes the index type and name in targetRef and labels an index Query/Scan distinctly", () => {
    const gsiQuery = buildDynamoDbAccessPatternViewModel(
      pattern({ accessPath: "indexQuery", indexName: "iCountry", indexType: "GSI" }),
    );
    expect(gsiQuery.targetRef).toBe("orders (GSI iCountry)");
    expect(gsiQuery.accessPathLabel).toBe("Index Query");

    const lsiScan = buildDynamoDbAccessPatternViewModel(
      pattern({ accessPath: "indexScan", indexName: "iKind", indexType: "LSI", partitionKey: { attributeName: "pk", conditionPresent: false } }),
    );
    expect(lsiScan.targetRef).toBe("orders (LSI iKind)");
    expect(lsiScan.accessPathLabel).toBe("Index Scan");
  });

  it("labels an unresolved access path as Unknown rather than defaulting to Scan or Query", () => {
    const view = buildDynamoDbAccessPatternViewModel(pattern({ accessPath: "unknown", confidence: "unknown" }));
    expect(view.accessPathLabel).toBe("Unknown");
  });

  it("labels consistentRead strong/unknown distinctly from the default eventual", () => {
    expect(buildDynamoDbAccessPatternViewModel(pattern({ consistentRead: "strong" })).consistentReadLabel).toBe(
      "Strongly consistent",
    );
    expect(buildDynamoDbAccessPatternViewModel(pattern({ consistentRead: "unknown" })).consistentReadLabel).toBe(
      "Unknown",
    );
  });

  it("formats limit and scan direction only when present", () => {
    const forward = buildDynamoDbAccessPatternViewModel(
      pattern({ limit: 25, resultItemLimit: 100, scanForward: true }),
    );
    expect(forward.apiLimitText).toBe("25");
    expect(forward.resultItemLimitText).toBe("100");
    expect(forward.scanDirectionLabel).toBe("Forward");

    const backward = buildDynamoDbAccessPatternViewModel(pattern({ scanForward: false }));
    expect(backward.scanDirectionLabel).toBe("Backward");
  });

  it("never includes a literal value - only attribute names/operators/booleans reach the view model", () => {
    const view = buildDynamoDbAccessPatternViewModel(
      pattern({
        partitionKey: { attributeName: "pk", operator: "IN", conditionPresent: true },
        postReadFilter: { present: true, attributes: ["email"] },
      }),
    );
    expect(JSON.stringify(view)).not.toMatch(/someone@example\.com|secret|[0-9]{6,}/);
  });
});
