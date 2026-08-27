import type { DynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { buildDynamoDbPerformanceTuningHumanSummary } from "../../src/utilities/dynamoDbPerformanceTuningHumanSummary";

function context(overrides: Partial<DynamoDbPerformanceTuningContext> = {}): DynamoDbPerformanceTuningContext {
  return {
    formatVersion: 1,
    engine: "dynamodb",
    service: {
      provider: "AWS",
      service: "DynamoDB",
      region: "ap-northeast-1",
      endpointKind: "aws",
      tableName: "orders",
    },
    statement: {
      language: "partiql",
      text: "SELECT * FROM orders WHERE pk = 'x'",
      source: "sqlHistory",
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
      projection: { mode: "allAttributes", allAttributes: true, attributes: [] },
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
    collection: {
      collectedAt: "2026-08-24T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
    ...overrides,
  };
}

describe("buildDynamoDbPerformanceTuningHumanSummary", () => {
  it("summarizes a certain Query with no workload/observation/CloudWatch evidence", () => {
    const summary = buildDynamoDbPerformanceTuningHumanSummary(context());

    expect(summary.profile).toEqual({
      operation: "PartiQLSelect",
      accessPath: "tableQuery",
      confidence: "certain",
      targetRef: "orders",
      evidence: "none",
      collectionStatus: "complete",
    });
    expect(summary.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "accessPath", level: "info", title: expect.stringContaining("Query") }),
      expect.objectContaining({ kind: "capacity", level: "unknown" }),
      expect.objectContaining({ kind: "observation", level: "unknown" }),
      expect.objectContaining({ kind: "throttling", level: "unknown" }),
    ]));
    // No "collection is partial" signal when status is complete.
    expect(summary.signals.some((s) => s.kind === "collection")).toBe(false);
  });

  it("flags a full table scan as attention and mentions the post-read filter cost separately", () => {
    const value = context({
      accessPattern: {
        operation: "PartiQLSelect",
        accessPath: "tableScan",
        confidence: "certain",
        tableName: "orders",
        partitionKey: { attributeName: "pk", conditionPresent: false },
        postReadFilter: { present: true, attributes: ["status"] },
        projection: { mode: "allAttributes", allAttributes: true, attributes: [] },
        consistentRead: "eventual",
      },
    });
    const signal = buildDynamoDbPerformanceTuningHumanSummary(value).signals.find((s) => s.kind === "accessPath");
    expect(signal?.level).toBe("attention");
    expect(signal?.summary).toContain("full table scan");
    expect(signal?.summary).toContain("status");
    expect(signal?.summary).toContain("already spent reading the filtered-out items");
  });

  it("marks an unresolved access path as unknown, not a scan or a query", () => {
    const value = context({
      accessPattern: {
        operation: "PartiQLSelect",
        accessPath: "unknown",
        confidence: "unknown",
        tableName: "orders",
        postReadFilter: { present: false, attributes: [] },
        projection: { mode: "allAttributes", allAttributes: true, attributes: [] },
        consistentRead: "unknown",
      },
    });
    const signal = buildDynamoDbPerformanceTuningHumanSummary(value).signals.find((s) => s.kind === "accessPath");
    expect(signal?.level).toBe("unknown");
    expect(signal?.summary).toContain("could not be safely classified");
  });

  it("includes the index in targetRef and profile when an index was resolved", () => {
    const value = context({
      service: {
        provider: "AWS",
        service: "DynamoDB",
        endpointKind: "aws",
        tableName: "orders",
        indexName: "iCountry",
      },
      accessPattern: {
        operation: "Query",
        accessPath: "indexQuery",
        confidence: "certain",
        tableName: "orders",
        indexName: "iCountry",
        indexType: "GSI",
        partitionKey: { attributeName: "country", operator: "=", conditionPresent: true },
        postReadFilter: { present: false, attributes: [] },
        projection: { mode: "allAttributes", allAttributes: true, attributes: [] },
        consistentRead: "eventual",
      },
    });
    const summary = buildDynamoDbPerformanceTuningHumanSummary(value);
    expect(summary.profile.targetRef).toBe("orders (GSI iCountry)");
  });

  it("reports Capacity workload history when present, and treats 0 samples as no history", () => {
    const withWorkload = context({
      workload: { capacitySampleCount: 3, totalCapacityUnits: 9, averageCapacityUnits: 3, maxCapacityUnits: 5, lastCapacityUnits: 2 },
    });
    const summary = buildDynamoDbPerformanceTuningHumanSummary(withWorkload);
    expect(summary.profile.evidence).toBe("workload");
    const capacitySignal = summary.signals.find((s) => s.kind === "capacity");
    expect(capacitySignal?.level).toBe("info");
    expect(capacitySignal?.summary).toContain("3 prior execution(s)");
    expect(capacitySignal?.summary).toContain("averaged 3");
    expect(capacitySignal?.summary).toContain("peaked at 5");
    expect(capacitySignal?.summary).toContain("was 2 most recently");

    const withZeroSamples = context({ workload: { capacitySampleCount: 0 } });
    expect(
      buildDynamoDbPerformanceTuningHumanSummary(withZeroSamples).signals.find((s) => s.kind === "capacity")?.level,
    ).toBe("unknown");
  });

  it("reports observed-read evidence, omitting scanned/pass-rate for a PartiQL observation", () => {
    const value = context({
      observation: {
        source: "observedRead",
        returnedItemCount: 5,
        requestCount: 1,
        retryCount: 0,
        bounded: true,
        boundDescription: "Limited to a single API response by Run Observed Read.",
      },
    });
    const summary = buildDynamoDbPerformanceTuningHumanSummary(value);
    expect(summary.profile.evidence).toBe("observed");
    const signal = summary.signals.find((s) => s.kind === "observation");
    expect(signal?.level).toBe("info");
    expect(signal?.summary).toContain("returned 5 item(s)");
    expect(signal?.summary).not.toContain("scanned");
    expect(signal?.summary).toContain("confirmed Run Observed Read");
    expect(signal?.summary).toContain("bounded");
  });

  it("includes evaluated count and pass rate for a native Query observation", () => {
    const value = context({
      observation: {
        source: "sqlHistory",
        returnedItemCount: 2,
        evaluatedItemCount: 20,
        filterPassRate: 0.1,
        requestCount: 1,
        retryCount: 0,
        bounded: false,
      },
    });
    const signal = buildDynamoDbPerformanceTuningHumanSummary(value).signals.find((s) => s.kind === "observation");
    expect(signal?.summary).toContain("evaluated 20");
    expect(signal?.summary).toContain("10%");
    expect(signal?.summary).toContain("prior SQL History execution");
  });

  it("flags throttling activity from diagnostics as attention, regardless of which throttle code fired", () => {
    const value = context({
      cloudWatch: { window: { startTime: "t0", endTime: "t1", periodSeconds: 60 }, series: [] },
      collection: {
        collectedAt: "2026-08-24T00:00:00.000Z",
        status: "partial",
        diagnostics: [
          {
            code: "DYNAMODB_KEY_RANGE_THROTTLING_OBSERVED",
            severity: "warning",
            affectsCompleteness: false,
            scope: "cloudWatchMetrics",
            message: "ReadKeyRangeThroughputThrottleEvents was observed.",
            tableName: "orders",
            metricName: "ReadKeyRangeThroughputThrottleEvents",
          },
        ],
        unavailableSections: [],
      },
    });
    const summary = buildDynamoDbPerformanceTuningHumanSummary(value);
    const signal = summary.signals.find((s) => s.kind === "throttling");
    expect(signal?.level).toBe("attention");
    expect(signal?.summary).toContain("ReadKeyRangeThroughputThrottleEvents");
    // Unrelated diagnostics (not a throttle code) must not trip this signal.
    expect(summary.signals.filter((s) => s.kind === "throttling")).toHaveLength(1);
  });

  it("reports no-throttling info only when CloudWatch was actually collected", () => {
    const withData = context({
      cloudWatch: { window: { startTime: "t0", endTime: "t1", periodSeconds: 60 }, series: [] },
    });
    expect(
      buildDynamoDbPerformanceTuningHumanSummary(withData).signals.find((s) => s.kind === "throttling")?.level,
    ).toBe("info");

    const withoutData = context();
    expect(
      buildDynamoDbPerformanceTuningHumanSummary(withoutData).signals.find((s) => s.kind === "throttling")?.level,
    ).toBe("unknown");
  });

  it("does not turn missing throttle datapoints into a confirmed zero", () => {
    const value = context({
      cloudWatch: { window: { startTime: "t0", endTime: "t1", periodSeconds: 60 }, series: [] },
      collection: {
        collectedAt: "2026-08-24T00:00:00.000Z",
        status: "complete",
        diagnostics: [
          {
            code: "DYNAMODB_CLOUDWATCH_NO_DATA",
            severity: "info",
            affectsCompleteness: false,
            scope: "cloudWatchMetrics",
            message: "No CloudWatch datapoints for ReadThrottleEvents (Sum).",
            tableName: "orders",
            metricName: "ReadThrottleEvents",
          },
        ],
        unavailableSections: [],
      },
    });
    const signal = buildDynamoDbPerformanceTuningHumanSummary(value).signals.find((s) => s.kind === "throttling");
    expect(signal).toMatchObject({
      level: "info",
      title: "No throttle datapoints reported",
    });
    expect(signal?.summary).toContain("missing datapoints are not treated as a confirmed zero");
    expect(signal?.rawDataPath).toContain("collection.diagnostics");
  });

  it("treats intentionally skipped monitoring as informational instead of unknown", () => {
    const value = context({
      collection: {
        collectedAt: "2026-08-24T00:00:00.000Z",
        status: "complete",
        diagnostics: [
          {
            code: "DYNAMODB_MONITORING_COLLECTION_SKIPPED",
            severity: "info",
            affectsCompleteness: false,
            scope: "collection",
            message: "CloudWatch metrics and Contributor Insights were not collected because CloudWatch is not enabled for this connection.",
            tableName: "orders",
          },
        ],
        unavailableSections: [],
      },
    });

    const summary = buildDynamoDbPerformanceTuningHumanSummary(value);
    const signal = summary.signals.find((s) => s.kind === "throttling");
    expect(signal).toMatchObject({
      level: "info",
      title: "CloudWatch monitoring not collected",
      summary: expect.stringContaining("not enabled for this connection"),
    });
    expect(summary.signals.some((s) => s.kind === "collection")).toBe(false);
  });

  it("adds a collection-partial signal only when collection.status is partial", () => {
    const value = context({
      collection: {
        collectedAt: "2026-08-24T00:00:00.000Z",
        status: "partial",
        diagnostics: [],
        unavailableSections: [{ section: "cloudWatchMetrics", tableName: "orders", reason: "AccessDenied" }],
      },
    });
    const summary = buildDynamoDbPerformanceTuningHumanSummary(value);
    expect(summary.profile.collectionStatus).toBe("partial");
    const signal = summary.signals.find((s) => s.kind === "collection");
    expect(signal?.level).toBe("attention");
    expect(signal?.summary).toContain("1 section(s)");
  });
});
