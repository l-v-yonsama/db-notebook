import type { DynamoDbReadObservation } from "@l-v-yonsama/multi-platform-database-drivers";

const RUN_WARNING =
  '"Run Observed Read" reads and evaluates real items from the table above (first response only, up to 100 items evaluated), instead of only classifying the statement statically.';

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
  const qualifierSummary = qualifiers.length > 0 ? ` (${qualifiers.join("; ")})` : "";
  const continuationSummary = observation.hasMorePages
    ? " DynamoDB returned a continuation marker, so unevaluated items may remain; later pages may or may not contain matches."
    : "";
  const rerunSummary = observation.source === "observedRead"
    ? " Running it again starts a new observed read from the beginning and reads real items again."
    : " Running Run Observed Read starts a new read from the beginning and reads real items.";

  return `${prefix}${itemSummary}${qualifierSummary}.${continuationSummary}${rerunSummary}`;
}
