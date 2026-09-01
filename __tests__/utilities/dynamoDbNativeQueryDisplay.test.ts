import { describe, expect, it } from "vitest";
import {
  buildDynamoDbNativeQueryPreviewInput,
  buildDynamoDbNativeQueryViewModel,
  formatDynamoDbAttributeValueForDisplay,
} from "../../src/utilities/dynamoDbNativeQueryDisplay";

describe("DynamoDB native Query Preview display", () => {
  it("keeps the cross-page result cap out of the AWS-shaped Query preview", () => {
    const executableInput = {
      TableName: "orders",
      KeyConditionExpression: "#tenant = :tenant",
      ExpressionAttributeNames: { "#tenant": "tenantId" },
      ExpressionAttributeValues: { ":tenant": { S: "T#001" } },
      Limit: 100,
    };

    const previewInput = buildDynamoDbNativeQueryPreviewInput(executableInput);

    expect(previewInput).not.toHaveProperty("Limit");
    expect(previewInput).toMatchObject({
      TableName: "orders",
      KeyConditionExpression: "#tenant = :tenant",
    });
    expect(executableInput.Limit).toBe(100);
  });

  it("resolves expression names and values without changing the performance context", () => {
    const view = buildDynamoDbNativeQueryViewModel({
      TableName: "orders",
      IndexName: "tenant-status-gsi",
      KeyConditionExpression: "#tenant = :tenant AND begins_with(#order, :prefix)",
      FilterExpression: "#status = :status",
      ProjectionExpression: "#tenant, #order, #status",
      ExpressionAttributeNames: {
        "#tenant": "tenantId",
        "#order": "orderId",
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":tenant": { S: "T#001" },
        ":prefix": { S: "ORDER#2026" },
        ":status": { S: "PENDING" },
      },
      ConsistentRead: false,
      ScanIndexForward: false,
      Limit: 100,
    });

    expect(view).toMatchObject({
      target: "orders.tenant-status-gsi",
      keyCondition: {
        raw: "#tenant = :tenant AND begins_with(#order, :prefix)",
        resolved: 'tenantId = "T#001" AND begins_with(orderId, "ORDER#2026")',
      },
      filter: { resolved: 'status = "PENDING"' },
      projection: { resolved: "tenantId, orderId, status" },
      consistentRead: "Eventual",
      scanDirection: "Descending",
      limit: 100,
    });
    expect(view.expressionAttributeValues).toContainEqual({
      token: ":tenant",
      value: '"T#001"',
    });
  });

  it("formats nested and binary DynamoDB values for a readable ephemeral display", () => {
    expect(formatDynamoDbAttributeValueForDisplay({ N: "12.5" })).toBe("12.5");
    expect(formatDynamoDbAttributeValueForDisplay({ BOOL: true })).toBe("true");
    expect(formatDynamoDbAttributeValueForDisplay({ L: [{ S: "a" }, { N: "2" }] }))
      .toBe('["a", 2]');
    expect(formatDynamoDbAttributeValueForDisplay({ B: Uint8Array.from([1, 2, 3]) }))
      .toBe('base64("AQID")');
  });
});
