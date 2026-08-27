import {
  quoteIdentifier,
  quoteStringLiteral,
  type QueryItemsAtClientInputParams,
} from "@l-v-yonsama/multi-platform-database-drivers";

const toPartiqlLiteral = (attributeValue: unknown): string => {
  if (!attributeValue || typeof attributeValue !== "object") {
    throw new Error("A DynamoDB expression attribute value is missing or invalid.");
  }
  const entries = Object.entries(attributeValue as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new Error("A DynamoDB expression attribute value must contain exactly one type.");
  }
  const [type, value] = entries[0];
  switch (type) {
    case "S":
      return quoteStringLiteral(String(value));
    case "N": {
      const numberText = String(value);
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(numberText)) {
        throw new Error(`'${numberText}' is not a valid DynamoDB number.`);
      }
      return numberText;
    }
    case "BOOL":
      if (value === true || value === "true") {
        return "TRUE";
      }
      if (value === false || value === "false") {
        return "FALSE";
      }
      throw new Error(`'${String(value)}' is not a valid DynamoDB boolean.`);
    case "NULL":
      return "NULL";
    case "SS":
      if (!Array.isArray(value)) {
        throw new Error("A DynamoDB String Set value must be an array.");
      }
      return `<<${value.map((item) => quoteStringLiteral(String(item))).join(", ")}>>`;
    case "NS":
      if (!Array.isArray(value)) {
        throw new Error("A DynamoDB Number Set value must be an array.");
      }
      return `<<${value
        .map((item) => toPartiqlLiteral({ N: item }))
        .join(", ")}>>`;
    case "B":
    case "BS":
      throw new Error(
        "DynamoDB PartiQL has no binary literal syntax. Use Native Query for binary values."
      );
    default:
      throw new Error(`DynamoDB type '${type}' cannot be represented by this PartiQL builder.`);
  }
};

const replaceTokens = (
  expression: string,
  input: QueryItemsAtClientInputParams
): string => {
  const names = input.ExpressionAttributeNames ?? {};
  const values = input.ExpressionAttributeValues ?? {};
  // Replace tokens in the original expression in one pass. Sequential
  // string replacement could mistakenly rewrite '#name' or ':value' text
  // that happens to occur inside a string literal inserted by an earlier
  // replacement.
  return expression.replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g, (token) => {
    if (token.startsWith("#")) {
      const name = names[token];
      if (name === undefined) {
        throw new Error(`ExpressionAttributeNames does not contain '${token}'.`);
      }
      return quoteIdentifier(name);
    }
    const value = values[token];
    if (value === undefined) {
      throw new Error(`ExpressionAttributeValues does not contain '${token}'.`);
    }
    return toPartiqlLiteral(value);
  });
};

export const buildDynamoPartiqlSelect = (params: {
  input: QueryItemsAtClientInputParams;
  sortKeyName?: string;
}): string => {
  const { input, sortKeyName } = params;
  if (!input.TableName) {
    throw new Error("TableName is required to build PartiQL.");
  }
  if (!input.KeyConditionExpression?.trim()) {
    throw new Error("KeyConditionExpression is required to build PartiQL.");
  }

  const projection = input.ProjectionExpression?.trim()
    ? replaceTokens(input.ProjectionExpression, input)
    : "*";
  const from = input.IndexName
    ? `${quoteIdentifier(input.TableName)}.${quoteIdentifier(input.IndexName)}`
    : quoteIdentifier(input.TableName);
  const conditions = [input.KeyConditionExpression, input.FilterExpression]
    .filter((value): value is string => !!value?.trim())
    .map((value) => replaceTokens(value, input));
  const lines = [`SELECT ${projection}`, `FROM ${from}`, `WHERE ${conditions.join(" AND ")}`];

  if (input.ScanIndexForward === false && sortKeyName) {
    lines.push(`ORDER BY ${quoteIdentifier(sortKeyName)} DESC`);
  }
  if (typeof input.Limit === "number" && input.Limit > 0) {
    // db-drivers removes this clause and passes it as ExecuteStatement.Limit;
    // keeping it in the cell is Database Notebook's established PartiQL
    // convention and makes the configured maximum visible/reproducible.
    lines.push(`LIMIT ${input.Limit}`);
  }
  return `${lines.join("\n")};`;
};
