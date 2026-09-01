import type { QueryItemsAtClientInputParams } from "@l-v-yonsama/multi-platform-database-drivers";
import type { DynamoDbNativeQueryViewModel } from "../shared/MessageEventData";

/**
 * Builds the Query Panel's AWS-shaped preview without exposing the panel's
 * cross-page result cap as DynamoDB's per-request Query Limit.
 *
 * The executable input retains Limit because queryItemsAtClient uses it to
 * stop its pagination loop after enough result items have been collected.
 */
export function buildDynamoDbNativeQueryPreviewInput(
  input: QueryItemsAtClientInputParams
): QueryItemsAtClientInputParams {
  const previewInput = { ...input };
  delete previewInput.Limit;
  return previewInput;
}

const binaryText = (value: unknown): string => {
  if (value instanceof Uint8Array) {
    return `base64(${JSON.stringify(Buffer.from(value).toString("base64"))})`;
  }
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "Buffer" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return `base64(${JSON.stringify(Buffer.from((value as { data: number[] }).data).toString("base64"))})`;
  }
  return `base64(${JSON.stringify(String(value))})`;
};

export const formatDynamoDbAttributeValueForDisplay = (attributeValue: unknown): string => {
  if (!attributeValue || typeof attributeValue !== "object") {
    return String(attributeValue);
  }
  const entries = Object.entries(attributeValue as Record<string, unknown>);
  if (entries.length !== 1) {
    return JSON.stringify(attributeValue);
  }
  const [type, value] = entries[0];
  switch (type) {
    case "S":
      return JSON.stringify(String(value));
    case "N":
      return String(value);
    case "BOOL":
      return value === true || value === "true" ? "true" : "false";
    case "NULL":
      return "null";
    case "B":
      return binaryText(value);
    case "SS":
      return `[${(Array.isArray(value) ? value : []).map((item) => JSON.stringify(String(item))).join(", ")}]`;
    case "NS":
      return `[${(Array.isArray(value) ? value : []).map(String).join(", ")}]`;
    case "BS":
      return `[${(Array.isArray(value) ? value : []).map(binaryText).join(", ")}]`;
    case "L":
      return `[${(Array.isArray(value) ? value : []).map(formatDynamoDbAttributeValueForDisplay).join(", ")}]`;
    case "M":
      return `{ ${Object.entries((value ?? {}) as Record<string, unknown>)
        .map(([key, item]) => `${JSON.stringify(key)}: ${formatDynamoDbAttributeValueForDisplay(item)}`)
        .join(", ")} }`;
    default:
      return JSON.stringify(attributeValue);
  }
};

const resolveExpression = (
  expression: string | undefined,
  input: QueryItemsAtClientInputParams
): string | undefined => expression?.replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g, (token) => {
  if (token.startsWith("#")) {
    return input.ExpressionAttributeNames?.[token] ?? token;
  }
  const value = input.ExpressionAttributeValues?.[token];
  return value === undefined ? token : formatDynamoDbAttributeValueForDisplay(value);
});

export function buildDynamoDbNativeQueryViewModel(
  input: QueryItemsAtClientInputParams
): DynamoDbNativeQueryViewModel {
  return {
    target: input.IndexName ? `${input.TableName}.${input.IndexName}` : input.TableName ?? "unknown",
    keyCondition: {
      raw: input.KeyConditionExpression ?? "",
      resolved: resolveExpression(input.KeyConditionExpression, input) ?? "",
    },
    filter: input.FilterExpression
      ? { raw: input.FilterExpression, resolved: resolveExpression(input.FilterExpression, input) ?? input.FilterExpression }
      : undefined,
    projection: input.ProjectionExpression
      ? { raw: input.ProjectionExpression, resolved: resolveExpression(input.ProjectionExpression, input) ?? input.ProjectionExpression }
      : undefined,
    select: input.Select,
    expressionAttributeNames: Object.entries(input.ExpressionAttributeNames ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([token, name]) => ({ token, name })),
    expressionAttributeValues: Object.entries(input.ExpressionAttributeValues ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([token, value]) => ({ token, value: formatDynamoDbAttributeValueForDisplay(value) })),
    consistentRead: input.ConsistentRead === true ? "Strong" : "Eventual",
    scanDirection: input.ScanIndexForward === false ? "Descending" : "Ascending",
    limit: input.Limit,
  };
}
