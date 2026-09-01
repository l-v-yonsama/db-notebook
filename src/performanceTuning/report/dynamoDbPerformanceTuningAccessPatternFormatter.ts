import type { DynamoDbAccessPattern } from "@l-v-yonsama/multi-platform-database-drivers";
import type { DynamoDbAccessPatternViewModel } from "../../shared/MessageEventData";

// Formats the values-free access-pattern data for display without drawing conclusions.

function operationLabel(operation: DynamoDbAccessPattern["operation"]): string {
  switch (operation) {
    case "PartiQLSelect":
      return "PartiQL SELECT";
    case "Query":
      return "Query";
    case "Scan":
      return "Scan";
    default:
      return operation;
  }
}

function accessPathLabel(accessPath: DynamoDbAccessPattern["accessPath"]): string {
  switch (accessPath) {
    case "tableQuery":
      return "Table Query";
    case "indexQuery":
      return "Index Query";
    case "tableScan":
      return "Table Scan";
    case "indexScan":
      return "Index Scan";
    case "unknown":
    default:
      return "Unknown";
  }
}

function targetRef(pattern: DynamoDbAccessPattern): string {
  if (!pattern.indexName) {
    return pattern.tableName;
  }
  return `${pattern.tableName} (${pattern.indexType ?? "index"} ${pattern.indexName})`;
}

function partitionKeyText(pk: DynamoDbAccessPattern["partitionKey"]): string {
  if (!pk) {
    return "Not resolved";
  }
  if (!pk.conditionPresent) {
    return `${pk.attributeName} — no condition (full scan)`;
  }
  return `${pk.attributeName} ${pk.operator ?? "="}`;
}

function sortKeyText(sk: DynamoDbAccessPattern["sortKey"]): string | undefined {
  if (!sk) {
    return undefined;
  }
  if (!sk.conditionPresent) {
    return `${sk.attributeName} — no condition`;
  }
  return sk.operator ? `${sk.attributeName} ${sk.operator}` : sk.attributeName;
}

function postReadFilterText(filter: DynamoDbAccessPattern["postReadFilter"]): string {
  if (!filter.present) {
    return "None";
  }
  return filter.attributes.length > 0 ? filter.attributes.join(", ") : "Present (attributes not resolved)";
}

function projectionText(projection: DynamoDbAccessPattern["projection"]): string {
  // Preserve the legacy all-attributes representation in saved previews.
  if (projection.mode === "allAttributes" || projection.allAttributes) {
    return "All table attributes";
  }
  if (projection.mode === "allProjectedAttributes") {
    return "All projected index attributes";
  }
  return projection.attributes.length > 0
    ? projection.attributes.join(", ")
    : "Specific attributes (not resolved)";
}

function consistentReadLabel(consistentRead: DynamoDbAccessPattern["consistentRead"]): string {
  switch (consistentRead) {
    case "strong":
      return "Strongly consistent";
    case "eventual":
      return "Eventually consistent";
    case "unknown":
    default:
      return "Unknown";
  }
}

export function buildDynamoDbAccessPatternViewModel(
  pattern: DynamoDbAccessPattern,
): DynamoDbAccessPatternViewModel {
  return {
    operationLabel: operationLabel(pattern.operation),
    accessPathLabel: accessPathLabel(pattern.accessPath),
    confidence: pattern.confidence,
    targetRef: targetRef(pattern),
    partitionKeyText: partitionKeyText(pattern.partitionKey),
    sortKeyText: sortKeyText(pattern.sortKey),
    postReadFilterText: postReadFilterText(pattern.postReadFilter),
    projectionText: projectionText(pattern.projection),
    consistentReadLabel: consistentReadLabel(pattern.consistentRead),
    apiLimitText: pattern.limit !== undefined ? String(pattern.limit) : undefined,
    resultItemLimitText: pattern.resultItemLimit !== undefined ? String(pattern.resultItemLimit) : undefined,
    scanDirectionLabel:
      pattern.scanForward === undefined ? undefined : pattern.scanForward ? "Forward" : "Backward",
  };
}
