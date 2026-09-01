import type { QueryItemsAtClientInputParams } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { toDynamoDbQueryAnalysisInput } from "../../src/utilities/dynamoDbQueryAnalysisInput";

describe("toDynamoDbQueryAnalysisInput", () => {
  it("maps every field to its camelCase analysis-input counterpart", () => {
    const input: QueryItemsAtClientInputParams = {
      TableName: "orders",
      IndexName: "iCountry",
      KeyConditionExpression: "#pk = :pk",
      FilterExpression: "#status = :status",
      ProjectionExpression: "#pk, #status",
      Select: "SPECIFIC_ATTRIBUTES",
      ExpressionAttributeNames: { "#pk": "pk", "#status": "status" },
      ExpressionAttributeValues: { ":pk": { S: "tenant#42" }, ":status": { S: "open" } },
      ConsistentRead: true,
      ScanIndexForward: false,
      Limit: 25,
    };
    expect(toDynamoDbQueryAnalysisInput(input)).toEqual({
      tableName: "orders",
      indexName: "iCountry",
      keyConditionExpression: "#pk = :pk",
      filterExpression: "#status = :status",
      projectionExpression: "#pk, #status",
      select: "SPECIFIC_ATTRIBUTES",
      expressionAttributeNames: { "#pk": "pk", "#status": "status" },
      consistentRead: true,
      scanIndexForward: false,
      resultItemLimit: 25,
    });
  });

  it("maps the panel's cross-response Limit only to resultItemLimit", () => {
    const result = toDynamoDbQueryAnalysisInput({
      TableName: "orders",
      KeyConditionExpression: "#pk = :pk",
      Limit: 42,
    });
    expect(result.limit).toBeUndefined();
    expect(result.resultItemLimit).toBe(42);
  });

  it("never leaks ExpressionAttributeValues (or any other literal-carrying field) into the result", () => {
    const input: QueryItemsAtClientInputParams = {
      TableName: "orders",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: "someone@example.com" } },
      ExclusiveStartKey: { pk: { S: "someone@example.com" } },
    };
    const result = toDynamoDbQueryAnalysisInput(input);
    expect(JSON.stringify(result)).not.toContain("someone@example.com");
    expect(result).not.toHaveProperty("expressionAttributeValues");
    expect(result).not.toHaveProperty("exclusiveStartKey");
  });

  it("omits optional fields that were not supplied, rather than defaulting them", () => {
    const result = toDynamoDbQueryAnalysisInput({ TableName: "orders", KeyConditionExpression: "#pk = :pk" });
    expect(result).toEqual({
      tableName: "orders",
      indexName: undefined,
      keyConditionExpression: "#pk = :pk",
      filterExpression: undefined,
      projectionExpression: undefined,
      select: undefined,
      expressionAttributeNames: undefined,
      consistentRead: undefined,
      scanIndexForward: undefined,
      resultItemLimit: undefined,
    });
  });

  it("throws when TableName is missing", () => {
    expect(() => toDynamoDbQueryAnalysisInput({ KeyConditionExpression: "#pk = :pk" } as QueryItemsAtClientInputParams)).toThrow(
      /TableName/,
    );
  });

  it("throws when KeyConditionExpression is missing", () => {
    expect(() => toDynamoDbQueryAnalysisInput({ TableName: "orders" })).toThrow(/KeyConditionExpression/);
  });
});
