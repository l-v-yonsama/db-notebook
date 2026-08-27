// §17.4 of
// misc/specs/performance-tuning-baseline-comparison-implementation-plan.ja.md

import type { DynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import type {
  DynamoDbComparisonEvidence,
  NumericComparison,
  PerformanceTuningComparisonEvidence,
} from "../../src/shared/PerformanceTuningComparison";
import { buildDynamoDbComparison } from "../../src/utilities/dynamoDbPerformanceTuningComparison";
import { dynamoContext } from "./performanceTuningComparisonFixtures";

function compare(
  baseline: DynamoDbPerformanceTuningContext,
  current: DynamoDbPerformanceTuningContext
): PerformanceTuningComparisonEvidence {
  return buildDynamoDbComparison({
    baseline,
    current,
    source: {
      baseline: {
        fileName: "baseline.dbn",
        contextSha256: "0".repeat(64),
        selectedAt: "2026-08-27T00:00:00.000Z",
      },
      current: { collectedAt: current.collection.collectedAt },
    },
    generatedAt: "2026-08-27T00:00:00.000Z",
  });
}

function engineOf(
  evidence: PerformanceTuningComparisonEvidence
): DynamoDbComparisonEvidence | undefined {
  return evidence.engineSpecific.kind === "dynamodb" ? evidence.engineSpecific.value : undefined;
}

function metric(
  evidence: PerformanceTuningComparisonEvidence,
  key: string
): NumericComparison | undefined {
  return [...(engineOf(evidence)?.metrics ?? []), ...evidence.common.workload.metrics].find(
    (candidate) => candidate.key === key
  );
}

function reasonCodes(evidence: PerformanceTuningComparisonEvidence): string[] {
  return evidence.comparability.reasons.map((reason) => reason.code);
}

/** The "after" side: the Scan became a partition-key Query on the table. */
function tableQueryContext(): DynamoDbPerformanceTuningContext {
  return dynamoContext({
    statement: {
      language: "partiql",
      text: "SELECT * FROM orders WHERE pk = 'CUSTOMER#1'",
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
    observation: {
      source: "observedRead",
      observedAt: "2026-08-06T00:00:00.000Z",
      clientElapsedTimeMs: 40,
      requestCount: 1,
      retryCount: 0,
      returnedItemCount: 20,
      evaluatedItemCount: 20,
      filterPassRate: 1,
      consumedCapacity: { readCapacityUnits: 3, table: { readCapacityUnits: 3 } },
      bounded: false,
      completeness: "complete",
    },
    collection: {
      collectedAt: "2026-08-06T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
  });
}

describe("buildDynamoDbComparison - Table Scan to Table Query", () => {
  const evidence = compare(dynamoContext(), tableQueryContext());

  it("reports the access path change", () => {
    expect(engineOf(evidence)?.accessPath).toEqual({
      baseline: "tableScan",
      current: "tableQuery",
      changed: true,
    });
    expect(engineOf(evidence)?.partitionKeyCondition).toEqual({
      baseline: undefined,
      current: "pk =",
      changed: true,
    });
  });

  it("reports the post-read filter disappearing", () => {
    expect(engineOf(evidence)?.postReadFilter).toEqual({
      baseline: ["status"],
      current: [],
      changed: true,
    });
  });

  it("computes evaluated-item, capacity, and request-count improvements", () => {
    expect(metric(evidence, "dynamodb.observation.evaluatedItemCount")).toMatchObject({
      baseline: 10_000,
      current: 20,
      improvementPercent: 99.8,
      assessment: "improved",
    });
    expect(metric(evidence, "dynamodb.observation.consumedReadCapacity")).toMatchObject({
      baseline: 500,
      current: 3,
      assessment: "improved",
    });
    expect(metric(evidence, "dynamodb.observation.requestCount")).toMatchObject({
      baseline: 4,
      current: 1,
      improvementPercent: 75,
      assessment: "improved",
    });
  });

  it("treats read efficiency as a rate, reporting percentage points alongside the rate change", () => {
    const efficiency = metric(evidence, "dynamodb.observation.filterPassRate");

    expect(efficiency?.direction).toBe("higherIsBetter");
    expect(efficiency?.assessment).toBe("improved");
    expect(efficiency?.percentagePointDelta).toBeCloseTo(99.8, 6);
  });

  it("leaves returned items as a neutral fact, not an improvement", () => {
    expect(metric(evidence, "dynamodb.observation.returnedItemCount")).toMatchObject({
      baseline: 20,
      current: 20,
      direction: "neutral",
      assessment: "unchanged",
    });
  });
});

describe("buildDynamoDbComparison - Table Query with filter to GSI Query", () => {
  const baseline = dynamoContext({
    accessPattern: {
      operation: "Query",
      accessPath: "tableQuery",
      confidence: "certain",
      tableName: "orders",
      partitionKey: { attributeName: "pk", operator: "=", conditionPresent: true },
      postReadFilter: { present: true, attributes: ["status"] },
      projection: { mode: "allAttributes", allAttributes: true, attributes: [] },
      consistentRead: "eventual",
    },
    statement: {
      language: "dynamodb-query",
      source: "sqlHistory",
      kind: "query",
      observationEligibility: { allowed: true },
    },
    observation: {
      source: "observedRead",
      clientElapsedTimeMs: 300,
      requestCount: 1,
      returnedItemCount: 5,
      evaluatedItemCount: 4_000,
      filterPassRate: 0.00125,
      consumedCapacity: { readCapacityUnits: 200, table: { readCapacityUnits: 200 } },
      bounded: false,
      completeness: "complete",
    },
  });
  const current = dynamoContext({
    statement: {
      language: "dynamodb-query",
      source: "sqlHistory",
      kind: "query",
      observationEligibility: { allowed: true },
    },
    accessPattern: {
      operation: "Query",
      accessPath: "indexQuery",
      confidence: "certain",
      tableName: "orders",
      indexName: "gsi_status",
      indexType: "GSI",
      partitionKey: { attributeName: "status", operator: "=", conditionPresent: true },
      postReadFilter: { present: false, attributes: [] },
      projection: { mode: "allProjectedAttributes", allAttributes: false, attributes: [] },
      consistentRead: "eventual",
    },
    table: {
      tableName: "orders",
      billingMode: "PAY_PER_REQUEST",
      keySchema: { partitionKey: { attributeName: "pk", attributeType: "S" } },
      attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
      localSecondaryIndexes: [],
      globalSecondaryIndexes: [
        {
          indexName: "gsi_status",
          indexType: "GSI",
          keySchema: { partitionKey: { attributeName: "status", attributeType: "S" } },
          projection: { projectionType: "ALL" },
        },
      ],
      contributorInsights: [],
    },
    observation: {
      source: "observedRead",
      clientElapsedTimeMs: 20,
      requestCount: 1,
      returnedItemCount: 5,
      evaluatedItemCount: 5,
      filterPassRate: 1,
      consumedCapacity: {
        readCapacityUnits: 1,
        globalSecondaryIndexes: { gsi_status: { readCapacityUnits: 1 } },
      },
      bounded: false,
      completeness: "complete",
    },
  });
  const evidence = compare(baseline, current);

  it("reports the read moving from the table to the index", () => {
    expect(engineOf(evidence)?.accessTarget).toEqual({
      baseline: "orders",
      current: "orders.gsi_status",
      changed: true,
    });
    expect(evidence.common.indexes.used).toEqual({
      baseline: [],
      current: ["orders.gsi_status"],
      changed: true,
    });
    expect(evidence.common.indexes.changes).toEqual([
      {
        kind: "observedOnlyInCurrent",
        current: {
          scope: "orders",
          indexName: "gsi_status",
          kind: "GSI",
          columns: ["status"],
          projectionType: "ALL",
          nonKeyAttributes: undefined,
        },
      },
    ]);
  });

  it("keeps table and index capacity on separate rows rather than summing them", () => {
    const table = metric(evidence, "dynamodb.observation.tableConsumedReadCapacity");
    const index = metric(evidence, "dynamodb.observation.indexConsumedReadCapacity.gsi_status");

    expect(table).toMatchObject({ baseline: 200, current: undefined, assessment: "noData" });
    expect(index).toMatchObject({ baseline: undefined, current: 1, assessment: "noData" });
    // The total is where the actual improvement is legible.
    expect(metric(evidence, "dynamodb.observation.consumedReadCapacity")).toMatchObject({
      baseline: 200,
      current: 1,
      assessment: "improved",
    });
  });

  it("still diffs the request when neither side has statement text", () => {
    expect(evidence.common.query.changed).toBe(true);
    expect(evidence.common.query.diff.some((line) => line.text.includes("gsi_status"))).toBe(true);
    // ExpressionAttributeValues never exist in the Context, so they can never
    // reach the diff either (§8.3, §15).
    expect(JSON.stringify(evidence.common.query)).not.toContain(":val");
  });
});

describe("buildDynamoDbComparison - observation completeness", () => {
  it("refuses to compare a bounded read against a complete one", () => {
    const bounded = dynamoContext();
    bounded.observation = {
      ...bounded.observation!,
      bounded: true,
      completeness: "bounded",
      boundDescription: "stopped after 1000 evaluated items",
    };
    const evidence = compare(bounded, tableQueryContext());

    expect(reasonCodes(evidence)).toContain("OBSERVATION_BOUNDED_ONE_SIDE");
    expect(evidence.comparability.level).toBe("partiallyComparable");

    const evaluated = metric(evidence, "dynamodb.observation.evaluatedItemCount");
    expect(evaluated?.comparability).toBe("notComparable");
    expect(evaluated?.improvementPercent).toBeUndefined();
    // Raw values still travel, so the Preview can show them without a verdict.
    expect(evaluated?.baseline).toBe(10_000);
    expect(evaluated?.current).toBe(20);
  });

  it("keeps the API Limit, the result cap, and the observation bound as three separate facts", () => {
    const baseline = dynamoContext();
    baseline.accessPattern.limit = 100;
    baseline.accessPattern.resultItemLimit = 500;
    baseline.observation = {
      ...baseline.observation!,
      boundDescription: "stopped after 1000 evaluated items",
    };
    const current = dynamoContext();
    current.accessPattern.limit = 100;
    current.accessPattern.resultItemLimit = 50;

    const limits = engineOf(compare(baseline, current))!.limits;

    expect(limits.apiLimit).toEqual({ baseline: 100, current: 100, changed: false });
    expect(limits.resultItemLimit).toEqual({ baseline: 500, current: 50, changed: true });
    expect(limits.observationBound).toEqual({
      baseline: "stopped after 1000 evaluated items",
      current: undefined,
      changed: true,
    });
  });
});

describe("buildDynamoDbComparison - CloudWatch", () => {
  const withCloudWatch = (
    context: DynamoDbPerformanceTuningContext,
    params: {
      start: string;
      end: string;
      periodSeconds: number;
      values: number[];
      noData?: boolean;
    }
  ): DynamoDbPerformanceTuningContext => ({
    ...context,
    cloudWatch: {
      window: { startTime: params.start, endTime: params.end, periodSeconds: params.periodSeconds },
      series: [
        {
          metricName: "ConsumedReadCapacityUnits",
          statistic: "Sum",
          scope: "table",
          timestamps: params.values.map((_, i) => `2026-08-02T0${i}:00:00.000Z`),
          values: params.values,
          noData: params.noData ?? false,
          source: "AWS/DynamoDB",
        },
      ],
    },
  });

  it("compares series when the two windows have the same shape", () => {
    const evidence = compare(
      withCloudWatch(dynamoContext(), {
        start: "2026-08-02T00:00:00.000Z",
        end: "2026-08-02T01:00:00.000Z",
        periodSeconds: 300,
        values: [100, 200],
      }),
      withCloudWatch(tableQueryContext(), {
        start: "2026-08-06T00:00:00.000Z",
        end: "2026-08-06T01:00:00.000Z",
        periodSeconds: 300,
        values: [10, 20],
      })
    );

    expect(engineOf(evidence)?.cloudWatch?.windowMismatch).toBe(false);
    expect(
      metric(evidence, "dynamodb.cloudWatch.ConsumedReadCapacityUnits.table.-.-")
    ).toMatchObject({ baseline: 150, current: 15, assessment: "improved" });
  });

  it("always states that CloudWatch is wider than the single statement", () => {
    const evidence = compare(
      withCloudWatch(dynamoContext(), {
        start: "2026-08-02T00:00:00.000Z",
        end: "2026-08-02T01:00:00.000Z",
        periodSeconds: 300,
        values: [100],
      }),
      tableQueryContext()
    );

    expect(reasonCodes(evidence)).toContain("CLOUDWATCH_SCOPE_WIDER_THAN_STATEMENT");
  });

  it("refuses to compare series across differently shaped windows", () => {
    const evidence = compare(
      withCloudWatch(dynamoContext(), {
        start: "2026-08-02T00:00:00.000Z",
        end: "2026-08-02T01:00:00.000Z",
        periodSeconds: 300,
        values: [100],
      }),
      withCloudWatch(tableQueryContext(), {
        start: "2026-08-06T00:00:00.000Z",
        end: "2026-08-06T06:00:00.000Z",
        periodSeconds: 300,
        values: [10],
      })
    );

    expect(engineOf(evidence)?.cloudWatch?.windowMismatch).toBe(true);
    expect(reasonCodes(evidence)).toContain("CLOUDWATCH_WINDOW_MISMATCH");
    expect(
      metric(evidence, "dynamodb.cloudWatch.ConsumedReadCapacityUnits.table.-.-")?.comparability
    ).toBe("notComparable");
  });

  it("never turns a noData series into a 0", () => {
    const evidence = compare(
      withCloudWatch(dynamoContext(), {
        start: "2026-08-02T00:00:00.000Z",
        end: "2026-08-02T01:00:00.000Z",
        periodSeconds: 300,
        values: [],
        noData: true,
      }),
      withCloudWatch(tableQueryContext(), {
        start: "2026-08-06T00:00:00.000Z",
        end: "2026-08-06T01:00:00.000Z",
        periodSeconds: 300,
        values: [10],
      })
    );
    const series = metric(evidence, "dynamodb.cloudWatch.ConsumedReadCapacityUnits.table.-.-");

    expect(series?.baseline).toBeUndefined();
    expect(series?.comparability).toBe("notComparable");
    expect(series?.reason).toContain("not the same as a measured 0");
    expect(series?.improvementPercent).toBeUndefined();
  });
});

describe("buildDynamoDbComparison - comparability", () => {
  it("refuses a different table", () => {
    const evidence = compare(
      dynamoContext(),
      dynamoContext({
        service: {
          provider: "AWS",
          service: "DynamoDB",
          region: "ap-northeast-1",
          endpointKind: "aws",
          tableName: "invoices",
        },
      })
    );

    expect(evidence.comparability.level).toBe("notComparable");
    expect(reasonCodes(evidence)).toContain("TABLE_MISMATCH");
  });

  it("refuses a different region", () => {
    const evidence = compare(
      dynamoContext(),
      dynamoContext({
        service: {
          provider: "AWS",
          service: "DynamoDB",
          region: "us-east-1",
          endpointKind: "aws",
          tableName: "orders",
        },
      })
    );

    expect(reasonCodes(evidence)).toContain("REGION_MISMATCH");
  });

  it("allows a PartiQL-to-native-Query comparison but flags it as partial", () => {
    const evidence = compare(
      dynamoContext(),
      dynamoContext({
        statement: {
          language: "dynamodb-query",
          source: "sqlHistory",
          kind: "query",
          observationEligibility: { allowed: true },
        },
      })
    );

    expect(evidence.comparability.level).toBe("partiallyComparable");
    expect(reasonCodes(evidence)).toContain("STATEMENT_KIND_MISMATCH");
  });

  it("always states that DescribeTable metadata is approximate", () => {
    expect(reasonCodes(compare(dynamoContext(), dynamoContext()))).toContain(
      "DYNAMODB_METADATA_APPROXIMATE"
    );
  });
});

describe("buildDynamoDbComparison - workload", () => {
  it("refuses to compare a rolling rate that includes bounded samples", () => {
    const evidence = compare(
      dynamoContext({
        workload: {
          source: "sqlHistory",
          executionCount: 10,
          weightedFilterPassRate: 0.01,
          boundedObservationCount: 3,
        },
      }),
      dynamoContext({
        workload: { source: "sqlHistory", executionCount: 10, weightedFilterPassRate: 0.9 },
      })
    );
    const rate = metric(evidence, "dynamodb.workload.weightedFilterPassRate");

    expect(rate?.comparability).toBe("notComparable");
    expect(rate?.reason).toContain("lower bounds");
  });

  it("refuses to compare totals aggregated over a different number of executions", () => {
    const evidence = compare(
      dynamoContext({
        workload: { source: "sqlHistory", executionCount: 10, totalEvaluatedItemCount: 100_000 },
      }),
      dynamoContext({
        workload: { source: "sqlHistory", executionCount: 3, totalEvaluatedItemCount: 300 },
      })
    );

    expect(metric(evidence, "dynamodb.workload.totalEvaluatedItemCount")?.comparability).toBe(
      "notComparable"
    );
  });
});

// --- Code review 2026-08-27 regressions -----------------------------------

describe("buildDynamoDbComparison - a blocking reason suppresses every improvement", () => {
  it("marks all metrics not comparable when the two sides are different tables", () => {
    const evidence = compare(
      dynamoContext(),
      tableQueryContext(),
    );
    expect(
      [...(engineOf(evidence)?.metrics ?? [])].some((m) => m.improvementPercent !== undefined),
    ).toBe(true);

    const crossTable = compare(
      dynamoContext(),
      dynamoContext({
        service: {
          provider: "AWS",
          service: "DynamoDB",
          region: "ap-northeast-1",
          endpointKind: "aws",
          tableName: "invoices",
        },
      }),
    );
    const all = [
      ...crossTable.common.workload.metrics,
      ...(engineOf(crossTable)?.metrics ?? []),
    ];

    expect(all.length).toBeGreaterThan(0);
    expect(all.every((m) => m.comparability === "notComparable")).toBe(true);
    expect(all.every((m) => m.improvementPercent === undefined)).toBe(true);
    expect(
      crossTable.comparability.metricDecisions.every((d) => d.comparability === "notComparable"),
    ).toBe(true);
  });
});

describe("buildDynamoDbComparison - two bounded observations", () => {
  const boundedAt = (description: string | undefined, evaluated: number) => {
    const context = dynamoContext();
    context.observation = {
      ...context.observation!,
      evaluatedItemCount: evaluated,
      bounded: true,
      completeness: "bounded",
      boundDescription: description,
    };
    return context;
  };

  it("refuses to compare two reads cut off at different points", () => {
    const evidence = compare(
      boundedAt("stopped after 10 evaluated items", 10),
      boundedAt("stopped after 100 evaluated items", 100),
    );

    expect(reasonCodes(evidence)).toContain("OBSERVATION_BOUNDS_DIFFER");
    expect(evidence.comparability.level).toBe("partiallyComparable");
    const evaluated = metric(evidence, "dynamodb.observation.evaluatedItemCount");
    expect(evaluated?.comparability).toBe("notComparable");
    expect(evaluated?.improvementPercent).toBeUndefined();
  });

  it("refuses when neither side recorded where it stopped", () => {
    const evidence = compare(boundedAt(undefined, 10), boundedAt(undefined, 100));

    expect(reasonCodes(evidence)).toContain("OBSERVATION_BOUNDS_DIFFER");
    expect(
      metric(evidence, "dynamodb.observation.consumedReadCapacity")?.comparability,
    ).toBe("notComparable");
  });

  it("compares two reads cut off at the same documented point", () => {
    const evidence = compare(
      boundedAt("stopped after 100 evaluated items", 100),
      boundedAt("stopped after 100 evaluated items", 40),
    );

    expect(reasonCodes(evidence)).not.toContain("OBSERVATION_BOUNDS_DIFFER");
    expect(reasonCodes(evidence)).not.toContain("OBSERVATION_BOUNDED_ONE_SIDE");
    expect(metric(evidence, "dynamodb.observation.evaluatedItemCount")).toMatchObject({
      comparability: "comparable",
      assessment: "improved",
    });
  });
});

describe("buildDynamoDbComparison - endpoint kind", () => {
  const atEndpoint = (endpointKind: "aws" | "custom") =>
    dynamoContext({
      service: {
        provider: "AWS",
        service: "DynamoDB",
        region: "ap-northeast-1",
        endpointKind,
        tableName: "orders",
      },
    });

  it("flags DynamoDB Local against real AWS and refuses client timings", () => {
    const evidence = compare(atEndpoint("custom"), atEndpoint("aws"));

    expect(reasonCodes(evidence)).toContain("ENVIRONMENT_MISMATCH");
    expect(evidence.comparability.level).toBe("partiallyComparable");
    expect(
      metric(evidence, "dynamodb.observation.clientElapsedTimeMs")?.comparability,
    ).toBe("notComparable");
    // Item counts and capacity are properties of the data and access path.
    expect(
      metric(evidence, "dynamodb.observation.evaluatedItemCount")?.comparability,
    ).toBe("comparable");
    expect(evidence.common.target.baseline?.endpointKind).toBe("custom");
    expect(evidence.common.target.current?.endpointKind).toBe("aws");
  });

  it("stays quiet when both sides use the same endpoint kind", () => {
    const evidence = compare(atEndpoint("aws"), atEndpoint("aws"));

    expect(reasonCodes(evidence)).not.toContain("ENVIRONMENT_MISMATCH");
    expect(
      metric(evidence, "dynamodb.observation.clientElapsedTimeMs")?.comparability,
    ).toBe("comparable");
  });
});
