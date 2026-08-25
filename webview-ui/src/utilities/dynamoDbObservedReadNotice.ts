import type { DynamoDbReadObservation } from "@l-v-yonsama/multi-platform-database-drivers";

const RUN_WARNING =
  '"Run Observed Read" reads real items from the table above (a single response, up to 100 items), instead of only classifying the statement statically.';

export function buildDynamoDbObservedReadNotice(
  observation: DynamoDbReadObservation | undefined,
): string {
  if (!observation) {
    return RUN_WARNING;
  }

  const prefix = observation.source === "observedRead"
    ? '"Run Observed Read" completed'
    : "Observed read evidence is already available";
  const returned = observation.returnedItemCount;
  const itemSummary = returned === undefined
    ? ""
    : `: ${returned.toLocaleString()} ${returned === 1 ? "item" : "items"} returned`;
  const qualifiers: string[] = [];
  if (observation.bounded) {
    qualifiers.push("single bounded response");
  }
  if (observation.hasMorePages) {
    qualifiers.push("more pages available");
  }
  const qualifierSummary = qualifiers.length > 0 ? ` (${qualifiers.join("; ")})` : "";

  return `${prefix}${itemSummary}${qualifierSummary}. Running it again will read real items from the table again.`;
}
