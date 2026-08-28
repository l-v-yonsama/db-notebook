import type { QueryItemsAtClientInputParams } from "@l-v-yonsama/multi-platform-database-drivers";
import type { RdhMeta, RdhSummary } from "@l-v-yonsama/rdh";

// Native Query history stores executable input separately from display-only sqlDoc.
export type QueryHistoryRequest =
  | {
      kind: "sql";
    }
  | {
      kind: "dynamodbQuery";
      // Identifies which UI can safely restore the saved native input.
      // into editable controls. Future native-query producers must not
      // automatically inherit the Query Panel's expression-shape contract.
      origin: "dynamoQueryPanel";
      // The real, value-ful native Query input this entry re-executes with
      // (kept local-only - see dynamoDbQueryAnalysisInput.ts's
      // toDynamoDbQueryAnalysisInput() for the values-free mirror sent to
      // Full Context/AI). Re-running merges the newest input here, the same
      // way existing Query History already keeps only the latest bind values.
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
export type QueryHistoryDynamoDbPerformance = {
  // Every execution with a summary.dynamoDb counts here.
  observationSampleCount: number;
  // Only executions whose evaluatedItemCount was defined (native Query/Scan,
  // never PartiQL) count here - see mergeDynamoDbPerformance in
  // queryHistoryUtil.ts.
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
export type QueryHistoryPerformance = {
  sampleCount: number;
  totalElapsedTimeMilli: number;
  maxElapsedTimeMilli?: number;
  lastElapsedTimeMilli?: number;
  // Manual trip-meter boundary. Evidence from summary/executedAt before this
  // instant is retained for History display/re-execution but must not be used
  // by Performance Tuning as part of the new measurement epoch.
  statisticsSince?: number;
  resetAt?: number;
  // Additive Capacity aggregates. DynamoDB executions are folded in from
  // summary.dynamoDb.consumedCapacity.totalCapacityUnits (the DynamoDB
  // telemetry source of truth); a non-DynamoDB producer may use the generic
  // summary.capacityUnits. Never defaulted to 0 when no value was reported. Field
  // names mirror db-drivers' DynamoDbWorkloadContext
  // (totalCapacityUnits/maxCapacityUnits/lastCapacityUnits/
  // capacitySampleCount) so the two stay easy to line up when a DynamoDB
  // Preview merges Query History workload into its Context.
  capacitySampleCount?: number;
  totalCapacityUnits?: number;
  maxCapacityUnits?: number;
  lastCapacityUnits?: number;
  dynamoDb?: QueryHistoryDynamoDbPerformance;
};

export type QueryHistory = {
  id: string;
  sqlDoc: string;
  variables?: {
    [key: string]: any;
  };
  // Optional discriminator - see QueryHistoryRequest's own doc comment for why
  // an absent value is treated as { kind: "sql" }.
  request?: QueryHistoryRequest;
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
  performance?: QueryHistoryPerformance;
};
