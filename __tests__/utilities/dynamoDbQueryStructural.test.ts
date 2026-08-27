import type { QueryItemsAtClientInputParams } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  buildDynamoQueryDisplayText,
  buildDynamoQueryStructuralKey,
} from "../../src/utilities/dynamoDbQueryStructural";

describe("buildDynamoQueryStructuralKey", () => {
  const baseInput: QueryItemsAtClientInputParams = {
    TableName: "orders",
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: { "#pk": "tenantId" },
    ExpressionAttributeValues: { ":pk": { S: "tenant#1" } },
    Limit: 100,
  };

  it("produces the same key for two executions differing only in ExpressionAttributeValues", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({
      ...baseInput,
      ExpressionAttributeValues: { ":pk": { S: "tenant#2" } },
    });
    expect(a).toBe(b);
  });

  it("ignores ExclusiveStartKey and ReturnConsumedCapacity", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({
      ...baseInput,
      ExclusiveStartKey: { pk: { S: "tenant#1" } },
      ReturnConsumedCapacity: "NONE",
    });
    expect(a).toBe(b);
  });

  it("is stable regardless of ExpressionAttributeNames key insertion order", () => {
    const a = buildDynamoQueryStructuralKey({
      ...baseInput,
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: { "#pk": "tenantId", "#status": "status" },
    });
    const b = buildDynamoQueryStructuralKey({
      ...baseInput,
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status", "#pk": "tenantId" },
    });
    expect(a).toBe(b);
  });

  it("differs when TableName differs", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({ ...baseInput, TableName: "otherTable" });
    expect(a).not.toBe(b);
  });

  it("differs when IndexName differs", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({ ...baseInput, IndexName: "iStatus" });
    expect(a).not.toBe(b);
  });

  it("differs when FilterExpression differs", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({ ...baseInput, FilterExpression: "#status = :status" });
    expect(a).not.toBe(b);
  });

  it("differs when ProjectionExpression differs", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({ ...baseInput, ProjectionExpression: "#p0" });
    expect(a).not.toBe(b);
  });

  it("differs when ConsistentRead differs", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({ ...baseInput, ConsistentRead: true });
    expect(a).not.toBe(b);
  });

  it("differs when ScanIndexForward differs", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({ ...baseInput, ScanIndexForward: false });
    expect(a).not.toBe(b);
  });

  it("differs when the Query Panel's result item Limit differs", () => {
    const a = buildDynamoQueryStructuralKey(baseInput);
    const b = buildDynamoQueryStructuralKey({ ...baseInput, Limit: 50 });
    expect(a).not.toBe(b);
  });
});

describe("buildDynamoQueryDisplayText", () => {
  it("never contains a literal value from ExpressionAttributeValues", () => {
    const text = buildDynamoQueryDisplayText({
      TableName: "orders",
      KeyConditionExpression: "#pk = :pk",
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: { "#pk": "tenantId", "#status": "status" },
      ExpressionAttributeValues: { ":pk": { S: "someone@example.com" }, ":status": { S: "SECRET" } },
    });
    expect(text).not.toContain("someone@example.com");
    expect(text).not.toContain("SECRET");
  });

  it("includes table, key condition, and filter", () => {
    const text = buildDynamoQueryDisplayText({
      TableName: "orders",
      KeyConditionExpression: "#pk = :pk",
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: { "#pk": "tenantId", "#status": "status" },
    });
    expect(text).toBe("DDB orders · K tenantId = … · F status = …");
  });

  it("shows the index name when querying an index", () => {
    const text = buildDynamoQueryDisplayText({
      TableName: "orders",
      IndexName: "iStatus",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "tenantId" },
    });
    expect(text).toBe("DDB orders@iStatus · K tenantId = …");
  });

  it("omits the filter line when there is no FilterExpression", () => {
    const text = buildDynamoQueryDisplayText({
      TableName: "orders",
      KeyConditionExpression: "#pk = :pk",
    });
    expect(text).not.toContain(" · F ");
  });

  it("leaves projection and read consistency to the hover's structural JSON", () => {
    const text = buildDynamoQueryDisplayText({
      TableName: "orders",
      IndexName: "lsiStatus",
      KeyConditionExpression: "#pk = :pk",
      Select: "ALL_ATTRIBUTES",
      ProjectionExpression: "#p0, #p1",
      ConsistentRead: true,
      ExpressionAttributeNames: { "#pk": "tenantId", "#p0": "tenantId", "#p1": "status" },
    });
    expect(text).toBe("DDB orders@lsiStatus · K tenantId = …");
  });

  it("keeps target, key, and filter visible while bounding a long label", () => {
    const text = buildDynamoQueryDisplayText({
      TableName: "dynamo_performance_lab_orders",
      KeyConditionExpression: "#pk = :pk",
      FilterExpression: "#status = :status AND #createdAt BETWEEN :from AND :to",
      ExpressionAttributeNames: {
        "#pk": "tenantId",
        "#status": "status",
        "#createdAt": "createdAt",
      },
    });

    expect(text).toBe(
      "DDB dynamo_perf…lab_orders · K tenantId = … · F status = … AND cr…"
    );
    expect(text.length).toBeLessThanOrEqual(70);
  });
});
