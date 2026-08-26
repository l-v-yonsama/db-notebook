import type {
  DynamoDbCapacityAmount,
  DynamoDbCapacityBreakdown,
  DynamoDbReadObservation,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { RdhDynamoDbCapacityAmount, RdhDynamoDbConsumedCapacity } from "@l-v-yonsama/rdh";
import type { SQLHistory } from "../types/SQLHistory";

// See misc/specs/dynamodb-query-panel-history-performance-implementation-plan.ja.md
// §9.1. Pure functions only - no vscode import.

function toPerformanceCapacityAmount(
  amount: RdhDynamoDbCapacityAmount | undefined
): DynamoDbCapacityAmount | undefined {
  if (!amount) {
    return undefined;
  }
  // Explicit field-by-field mapping (design doc §9.1's "型castだけで済ませ
  // ない") - the two types happen to share these three field names today,
  // but that is not guaranteed to stay true, and a cast would silently stop
  // catching a future rename on either side.
  return {
    capacityUnits: amount.capacityUnits,
    readCapacityUnits: amount.readCapacityUnits,
    writeCapacityUnits: amount.writeCapacityUnits,
  };
}

function toPerformanceCapacityAmountMap(
  amounts: Record<string, RdhDynamoDbCapacityAmount> | undefined
): Record<string, DynamoDbCapacityAmount> | undefined {
  if (!amounts) {
    return undefined;
  }
  const entries = Object.entries(amounts).flatMap(([name, amount]) => {
    const mapped = toPerformanceCapacityAmount(amount);
    return mapped ? [[name, mapped] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

// Maps rdh's explicitly-named RdhDynamoDbConsumedCapacity (totalCapacityUnits/
// totalReadCapacityUnits/totalWriteCapacityUnits) onto the existing
// DynamoDB Performance Tuning Context's DynamoDbCapacityBreakdown
// (capacityUnits/readCapacityUnits/writeCapacityUnits) - the two types are
// deliberately named differently (rdh's fields are prefixed "total" to make
// clear they are already summed across every paginated response) even
// though they describe the same thing, so this mapping is never a plain
// cast (design doc §9.1).
export function toPerformanceCapacityBreakdown(
  consumedCapacity: RdhDynamoDbConsumedCapacity | undefined
): DynamoDbCapacityBreakdown | undefined {
  if (!consumedCapacity) {
    return undefined;
  }
  const breakdown: DynamoDbCapacityBreakdown = {
    capacityUnits: consumedCapacity.totalCapacityUnits,
    readCapacityUnits: consumedCapacity.totalReadCapacityUnits,
    writeCapacityUnits: consumedCapacity.totalWriteCapacityUnits,
  };
  const table = toPerformanceCapacityAmount(consumedCapacity.table);
  if (table) {
    breakdown.table = table;
  }
  const lsi = toPerformanceCapacityAmountMap(consumedCapacity.localSecondaryIndexes);
  if (lsi) {
    breakdown.localSecondaryIndexes = lsi;
  }
  const gsi = toPerformanceCapacityAmountMap(consumedCapacity.globalSecondaryIndexes);
  if (gsi) {
    breakdown.globalSecondaryIndexes = gsi;
  }
  return breakdown;
}

// Builds a DynamoDbReadObservation from a SQL History entry's most recent
// execution (design doc §9.1) - the single source of truth is
// summary.dynamoDb; undefined when it is absent (an older/dev-era history
// entry saved before summary.dynamoDb existed, or a non-AWS connection) so
// that case is never fabricated into a "complete" observation (design doc
// §7.4/§9.1's "古い履歴でtoken状態が不明な場合は完全観測と断定しない", applied
// one step earlier: no dynamoDb evidence at all means no Observation).
export function buildObservationFromHistory(history: SQLHistory): DynamoDbReadObservation | undefined {
  const dynamoDb = history.summary?.dynamoDb;
  if (!dynamoDb) {
    return undefined;
  }

  const { returnedItemCount, evaluatedItemCount, continuationTokenPresent } = dynamoDb;
  const filterPassRate =
    evaluatedItemCount !== undefined && evaluatedItemCount > 0 && returnedItemCount !== undefined
      ? returnedItemCount / evaluatedItemCount
      : undefined;

  // 'complete': continuationTokenPresent === false - the execution
  // definitely evaluated everything a continuation key could have covered.
  // 'bounded': continuationTokenPresent === true - a later key range was
  // never evaluated.
  // 'unknown': continuationTokenPresent itself is undefined (e.g. an entry
  // saved by an intermediate build of this feature) - never treated as
  // 'complete'.
  const completeness: DynamoDbReadObservation["completeness"] =
    continuationTokenPresent === true ? "bounded" : continuationTokenPresent === false ? "complete" : "unknown";

  return {
    source: "sqlHistory",
    observedAt: history.executedAt ? new Date(history.executedAt).toISOString() : undefined,
    clientElapsedTimeMs: history.summary?.elapsedTimeMilli,
    requestCount: dynamoDb.successfulResponseCount,
    retryCount: dynamoDb.sdkRetryCount,
    returnedItemCount,
    evaluatedItemCount,
    filterPassRate,
    consumedCapacity: toPerformanceCapacityBreakdown(dynamoDb.consumedCapacity),
    hasMorePages: continuationTokenPresent,
    // `bounded` is the pre-existing boolean-only compat field (design doc
    // §9.1) - both 'bounded' and 'unknown' set it true so an older reader
    // that only understands `bounded` still shows a cautionary note rather
    // than implying a completeness this entry can't actually back up; only
    // a definite 'complete' sets it false.
    bounded: completeness !== "complete",
    boundDescription:
      completeness === "bounded"
        ? "The execution stopped while a continuation key remained; the later key range was not evaluated."
        : completeness === "unknown"
          ? "Whether this execution's result was complete could not be determined from the saved history entry."
          : undefined,
    completeness,
  };
}
