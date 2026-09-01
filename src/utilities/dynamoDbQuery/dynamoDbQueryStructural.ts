import type { QueryItemsAtClientInputParams } from "@l-v-yonsama/multi-platform-database-drivers";
import { QUERY_HISTORY_LABEL_MAX_LENGTH } from "../../constant";

// Pure structural identity and display helpers for native Query history.

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
// ReturnConsumedCapacity, mirroring how existing Query History already treats
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

const toValueFreeDisplayExpression = (
  expression: string,
  names: QueryItemsAtClientInputParams["ExpressionAttributeNames"]
): string =>
  expression.replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g, (token) =>
    token.startsWith("#") ? names?.[token] ?? token : "…"
  );

const abbreviateEnd = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;

const abbreviateMiddle = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  const remainingLength = maxLength - 1;
  const headLength = Math.ceil(remainingLength / 2);
  return `${value.slice(0, headLength)}…${value.slice(-(remainingLength - headLength))}`;
};

const buildBoundedDisplayParts = (
  sections: Array<{ prefix: string; value: string; weight: number; middle?: boolean }>
): string => {
  const separator = " · ";
  const decorationLength =
    sections.reduce((total, section) => total + section.prefix.length, 0) +
    separator.length * (sections.length - 1);
  const valueBudget = Math.max(sections.length, QUERY_HISTORY_LABEL_MAX_LENGTH - decorationLength);
  const totalWeight = sections.reduce((total, section) => total + section.weight, 0);
  let remainingBudget = valueBudget;

  return sections
    .map((section, index) => {
      const maxLength =
        index === sections.length - 1
          ? remainingBudget
          : Math.max(1, Math.floor((valueBudget * section.weight) / totalWeight));
      remainingBudget -= maxLength;
      const value = section.middle
        ? abbreviateMiddle(section.value, maxLength)
        : abbreviateEnd(section.value, maxLength);
      return `${section.prefix}${value}`;
    })
    .join(separator);
};

// Compact, value-free description stored in Query History. It is optimized
// for finding a native Query in the Tree View; projection and other details
// remain available in the structural JSON shown in the hover.
export function buildDynamoQueryDisplayText(input: QueryItemsAtClientInputParams): string {
  const target = `${input.TableName}${input.IndexName ? `@${input.IndexName}` : ""}`;
  const sections: Array<{ prefix: string; value: string; weight: number; middle?: boolean }> = [
    { prefix: "DDB ", value: target, weight: 4, middle: true },
  ];
  if (input.KeyConditionExpression) {
    sections.push({
      prefix: "K ",
      value: toValueFreeDisplayExpression(
        input.KeyConditionExpression,
        input.ExpressionAttributeNames
      ),
      weight: 3,
    });
  }
  if (input.FilterExpression) {
    sections.push({
      prefix: "F ",
      value: toValueFreeDisplayExpression(input.FilterExpression, input.ExpressionAttributeNames),
      weight: 3,
    });
  }
  return buildBoundedDisplayParts(sections);
}
