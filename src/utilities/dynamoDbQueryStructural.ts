import type { QueryItemsAtClientInputParams } from "@l-v-yonsama/multi-platform-database-drivers";

// See misc/specs/dynamodb-query-panel-history-performance-implementation-plan.ja.md
// §4.1/§4.2. Pure, host-and-webview-agnostic (no vscode import) - kept
// separate from dynamoDbProjection.ts, which needs DbDynamoTable and is
// host-only.

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key]);
        return acc;
      }, {});
  }
  return value;
}

// Deterministic JSON.stringify with object keys sorted at every level, so
// two structurally-identical native Query inputs built via different code
// paths (e.g. a differing insertion order of ExpressionAttributeNames) still
// produce the same key (design doc §4.2's "安定した canonical JSON").
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

// The fields that decide native Query history identity (design doc §4.2) -
// deliberately excludes ExpressionAttributeValues/ExclusiveStartKey/
// ReturnConsumedCapacity, mirroring how existing SQL History already treats
// bind variables as workload samples rather than identity.
export function buildDynamoQueryStructuralKey(input: QueryItemsAtClientInputParams): string {
  return stableStringify({
    tableName: input.TableName,
    indexName: input.IndexName,
    keyConditionExpression: input.KeyConditionExpression,
    filterExpression: input.FilterExpression,
    projectionExpression: input.ProjectionExpression,
    select: input.Select,
    expressionAttributeNames: input.ExpressionAttributeNames ?? {},
    consistentRead: input.ConsistentRead ?? false,
    scanIndexForward: input.ScanIndexForward ?? true,
    // The Query Panel's own result-item cap (design doc §6.3) - part of
    // identity because two histories that differ only in how many items
    // they cap the result at are not really "the same repeated execution".
    limit: input.Limit,
  });
}

// Value-free description text (design doc §4.1) - stored as SQLHistory's
// generic `sqlDoc` (Tree View/Notebook-cell compatibility) and as
// SQLHistoryRequest.displayText, but never used for re-execution or
// analysis. Never contains ExpressionAttributeValues:
// KeyConditionExpression/FilterExpression/ProjectionExpression only ever
// reference #name/:value aliases, never literal values.
export function buildDynamoQueryDisplayText(input: QueryItemsAtClientInputParams): string {
  const lines: string[] = [];
  lines.push(
    input.IndexName
      ? `DynamoDB Query ${input.TableName} (index: ${input.IndexName})`
      : `DynamoDB Query ${input.TableName}`
  );
  if (input.KeyConditionExpression) {
    lines.push(`Key: ${input.KeyConditionExpression}`);
  }
  if (input.FilterExpression) {
    lines.push(`Filter: ${input.FilterExpression}`);
  }
  if (input.Select === "ALL_ATTRIBUTES") {
    lines.push(`Projection: All table attributes`);
  } else if (input.ProjectionExpression) {
    lines.push(`Projection: ${input.ProjectionExpression}`);
  }
  if (input.ConsistentRead) {
    lines.push(`Consistent read: strong`);
  }
  return lines.join("\n");
}
