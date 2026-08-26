import type { QueryItemsAtClientInputParams } from "@l-v-yonsama/multi-platform-database-drivers";
import type { RdhMeta, RdhSummary } from "@l-v-yonsama/rdh";

// Discriminates what kind of statement produced this history entry. Absent
// (or "sql") means the existing PartiQL/RDB path: sqlDoc is the statement's
// canonical source and is what re-execution/Notebook-export/performance
// analysis all use. "dynamodbQuery" is a native DynamoDB Query issued by the
// Query Panel - see misc/specs/
// dynamodb-query-panel-history-performance-implementation-plan.ja.md §4.1.
// A stored history with no `request` field at all predates this type and is
// treated exactly like `{ kind: "sql" }` - no batch migration is performed.
export type SQLHistoryRequest =
  | {
      kind: "sql";
    }
  | {
      kind: "dynamodbQuery";
      // Identifies which UI can safely invert the saved native input back
      // into editable controls. Future native-query producers must not
      // automatically inherit the Query Panel's expression-shape contract.
      origin: "dynamoQueryPanel";
      // The real, value-ful native Query input this entry re-executes with
      // (kept local-only - see dynamoDbQueryAnalysisInput.ts's
      // toDynamoDbQueryAnalysisInput() for the values-free mirror sent to
      // Full Context/AI). Re-running merges the newest input here, the same
      // way existing SQL History already keeps only the latest bind values.
      input: QueryItemsAtClientInputParams;
      // Canonical identity key (design doc §4.2) - built by
      // dynamoDbQueryStructural.ts's buildDynamoQueryStructuralKey() from
      // structural fields only, excluding ExpressionAttributeValues/
      // ExclusiveStartKey/ReturnConsumedCapacity.
      structuralKey: string;
      // Value-free description (design doc §4.1) - identical to sqlDoc for
      // this entry; kept here too so DynamoDB-specific rendering never has
      // to re-derive it from `input`.
      displayText: string;
    };

// Rolling DynamoDB read-shape aggregate (design doc §7.3), folded in from
// summary.dynamoDb on every execution that has one - PartiQL/ExecuteStatement
// history included (it has returnedItemCount/consumedCapacity too, just no
// evaluatedItemCount), not only "dynamodbQuery"-kind entries. A non-AWS
// history's `performance.dynamoDb` simply stays undefined forever.
export type SQLHistoryDynamoDbPerformance = {
  // Every execution with a summary.dynamoDb counts here.
  observationSampleCount: number;
  // Only executions whose evaluatedItemCount was defined (native Query/Scan,
  // never PartiQL) count here - see mergeDynamoDbPerformance in
  // sqlHistoryUtil.ts.
  evaluatedCountSampleCount: number;
  totalReturnedItemCount: number;
  totalEvaluatedItemCount: number;
  // The most recent execution's own values, literally - left undefined when
  // the most recent execution itself didn't have one (e.g. its own
  // evaluatedItemCount/filterPassRate for a PartiQL run), never carried over
  // from an older sample.
  lastReturnedItemCount?: number;
  lastEvaluatedItemCount?: number;
  minFilterPassRate?: number;
  maxFilterPassRate?: number;
  lastFilterPassRate?: number;
  // Count of samples whose continuationTokenPresent was true - i.e. samples
  // that did not observe the statement's full result.
  boundedObservationCount: number;
};

// Duration stats accumulated across repeated executions of the same SQL
// (same trimmed sqlDoc + connectionName). Only executions with a measurable
// summary.elapsedTimeMilli contribute to these aggregates.
export type SQLHistoryPerformance = {
  sampleCount: number;
  totalElapsedTimeMilli: number;
  maxElapsedTimeMilli: number;
  lastElapsedTimeMilli: number;
  // Additive Capacity aggregates. DynamoDB executions are folded in from
  // summary.dynamoDb.consumedCapacity.totalCapacityUnits (the DynamoDB
  // telemetry source of truth); a non-DynamoDB producer may use the generic
  // summary.capacityUnits. Never defaulted to 0 when no value was reported. Field
  // names mirror db-drivers' DynamoDbWorkloadContext
  // (totalCapacityUnits/maxCapacityUnits/lastCapacityUnits/
  // capacitySampleCount) so the two stay easy to line up when a DynamoDB
  // Preview merges SQL History workload into its Context.
  capacitySampleCount?: number;
  totalCapacityUnits?: number;
  maxCapacityUnits?: number;
  lastCapacityUnits?: number;
  dynamoDb?: SQLHistoryDynamoDbPerformance;
};

export type SQLHistory = {
  id: string;
  sqlDoc: string;
  variables?: {
    [key: string]: any;
  };
  // Optional discriminator - see SQLHistoryRequest's own doc comment for why
  // an absent value is treated as { kind: "sql" }.
  request?: SQLHistoryRequest;
  meta?: RdhMeta;
  summary?: RdhSummary;
  // CellMeta
  connectionName: string;
  ruleFile?: string;
  codeResolverFile?: string;
  executedAt?: number;
  status?: "success" | "error";
  errorMessage?: string;
  lastErrorMessage?: string;
  lastErrorAt?: number;
  performance?: SQLHistoryPerformance;
};
