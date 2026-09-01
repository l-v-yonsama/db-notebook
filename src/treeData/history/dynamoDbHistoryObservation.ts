import type {
  DynamoDbCapacityAmount,
  DynamoDbCapacityBreakdown,
  DynamoDbReadObservation,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { RdhDynamoDbCapacityAmount, RdhDynamoDbConsumedCapacity } from "@l-v-yonsama/rdh";
import type { QueryHistory } from "../../types/QueryHistory";

// Converts the latest native Query history summary into one observation.

function toPerformanceCapacityAmount(
  amount: RdhDynamoDbCapacityAmount | undefined
): DynamoDbCapacityAmount | undefined {
  if (!amount) {
    return undefined;
  }
  // Map fields explicitly so future source/target changes remain type-checked.
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

// Builds a DynamoDbReadObservation from a Query History entry's most recent
// execution (design doc §9.1) - the single source of truth is
// summary.dynamoDb; undefined when it is absent (an older/dev-era history
// entry saved before summary.dynamoDb existed, or a non-AWS connection) so
// that case is never fabricated into a "complete" observation (design doc
// §7.4/§9.1's "古い履歴でtoken状態が不明な場合は完全観測と断定しない", applied
// one step earlier: no dynamoDb evidence at all means no Observation).
export function buildObservationFromHistory(
  history: QueryHistory
): DynamoDbReadObservation | undefined {
  if (
    history.performance?.statisticsSince !== undefined &&
    (history.executedAt === undefined || history.executedAt < history.performance.statisticsSince)
  ) {
    return undefined;
  }
  const dynamoDb = history.summary?.dynamoDb;
  if (!dynamoDb) {
    return undefined;
  }

  const { returnedItemCount, evaluatedItemCount, continuationTokenPresent } = dynamoDb;
  const filterPassRate =
    evaluatedItemCount !== undefined && evaluatedItemCount > 0 && returnedItemCount !== undefined
      ? returnedItemCount / evaluatedItemCount
      : undefined;

  // Missing continuation evidence remains unknown rather than implying completion.
  const completeness: DynamoDbReadObservation["completeness"] =
    continuationTokenPresent === true
      ? "bounded"
      : continuationTokenPresent === false
      ? "complete"
      : "unknown";

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
    // Keep older readers conservative by mapping unknown to bounded=true.
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
