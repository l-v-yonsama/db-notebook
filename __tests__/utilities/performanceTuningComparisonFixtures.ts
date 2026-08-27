// Shared Context builders for the Performance Tuning comparison tests
// (misc/specs/performance-tuning-baseline-comparison-implementation-plan.ja.md
// §17). Both builders default to a "Seq Scan, no index" shape so each test
// only has to state the one thing it is actually about.

import type {
  DynamoDbPerformanceTuningContext,
  PerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { PerformanceTuningBaselineSelection } from "../../src/shared/PerformanceTuningComparison";

export function rdbContext(
  overrides: Partial<PerformanceTuningContext> = {}
): PerformanceTuningContext {
  return {
    formatVersion: 1,
    database: { vendor: "PostgreSQL", version: "16.2", databaseName: "app" },
    statement: {
      sql: "SELECT id\nFROM orders\nWHERE status = 'open'",
      source: "editor",
      kind: "select",
      analyzeEligibility: { allowed: true },
    },
    executionPlan: {
      mode: "analyze",
      format: "json",
      planningTimeMs: 1.2,
      executionTimeMs: 400,
      normalizedPlan: {
        id: "n1",
        depth: 0,
        operation: "Seq Scan",
        relation: { schemaName: "public", tableName: "orders" },
        estimated: { rows: 1_000, totalCost: 900 },
        actual: { rows: 20, totalMs: 400, loops: 1 },
        buffers: { hit: 100, read: 900, written: 0 },
        temp: { read: 0, written: 0 },
        children: [],
      },
      dominantCostPlanNode: { planNodeId: "n1", metric: "actual", exclusiveValue: 400 },
    },
    tables: [
      {
        schemaName: "public",
        tableName: "orders",
        definition: {
          columns: [],
          constraints: [],
          indexes: [
            { indexName: "orders_pkey", unique: true, primary: true, columns: [{ columnName: "id" }] },
          ],
        },
        statistics: {
          estimatedRowCount: { value: 100_000, estimated: true, source: "catalog" },
          statisticsUpdatedAt: {
            value: "2026-08-01T00:00:00.000Z",
            estimated: false,
            source: "catalog",
          },
          columns: [],
        },
      },
    ],
    planTableMappings: [
      {
        planNodeId: "n1",
        schemaName: "public",
        tableName: "orders",
        estimatedRows: 1_000,
        actualRows: 20,
        tableAccessRows: { value: 100_000, estimated: false, source: "actual plan" },
        tableAccessFraction: { value: 1, estimated: false, source: "actual plan" },
        predicateFilterInputRows: { value: 100_000, estimated: false, source: "actual plan" },
        predicateFilterOutputRows: { value: 20, estimated: false, source: "actual plan" },
        predicateFilterSelectivity: { value: 0.0002, estimated: false, source: "actual plan" },
      },
    ],
    collection: {
      collectedAt: "2026-08-02T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
    ...overrides,
  };
}

export function dynamoContext(
  overrides: Partial<DynamoDbPerformanceTuningContext> = {}
): DynamoDbPerformanceTuningContext {
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
      text: "SELECT * FROM orders WHERE status = 'open'",
      source: "sqlHistory",
      kind: "select",
      observationEligibility: { allowed: true },
    },
    accessPattern: {
      operation: "PartiQLSelect",
      accessPath: "tableScan",
      confidence: "certain",
      tableName: "orders",
      postReadFilter: { present: true, attributes: ["status"] },
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
    observation: {
      source: "observedRead",
      observedAt: "2026-08-02T00:00:00.000Z",
      clientElapsedTimeMs: 800,
      requestCount: 4,
      retryCount: 0,
      returnedItemCount: 20,
      evaluatedItemCount: 10_000,
      filterPassRate: 0.002,
      consumedCapacity: { readCapacityUnits: 500, table: { readCapacityUnits: 500 } },
      bounded: false,
      completeness: "complete",
    },
    collection: {
      collectedAt: "2026-08-02T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
    ...overrides,
  };
}

/** Wraps a Context as a selected Baseline with stable source metadata. */
export function baselineOf(
  context: PerformanceTuningContext | DynamoDbPerformanceTuningContext
): PerformanceTuningBaselineSelection {
  return {
    source: {
      fileName: "baseline.dbn",
      sourcePath: "/reports/performance-tuning/baseline.dbn",
      contextSha256: "0".repeat(64),
      collectedAt: context.collection.collectedAt,
      selectedAt: "2026-08-27T00:00:00.000Z",
    },
    context,
  };
}

/** Serializes cells the way DBNotebookSerializer writes a saved report. */
export function dbnFileText(
  cells: Array<{ label?: string; value: string; kind?: number }>
): string {
  return JSON.stringify({
    cells: cells.map((cell) => ({
      kind: cell.kind ?? 2,
      language: "json",
      value: cell.value,
      metadata: cell.label ? { cellLabel: cell.label } : {},
      outputs: [],
    })),
    metadata: {},
  });
}
