import { describe, expect, it } from "vitest";
import { buildDynamoPartiqlSelect } from "../../../src/utilities/dynamoDbQuery/dynamoDbPartiqlBuilder";

describe("buildDynamoPartiqlSelect", () => {
  it("builds an executable indexed PartiQL SELECT from a Query Panel native input", () => {
    expect(
      buildDynamoPartiqlSelect({
        input: {
          TableName: 'order"table',
          IndexName: "status-index",
          KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :sk1 AND :sk2",
          FilterExpression: "#status = :status AND contains(#note, :note)",
          ProjectionExpression: "#tenant, #amount",
          ExpressionAttributeNames: {
            "#pk": "tenantId",
            "#sk": "createdAt",
            "#status": "status",
            "#note": "note",
            "#tenant": "tenantId",
            "#amount": "total amount",
          },
          ExpressionAttributeValues: {
            ":pk": { S: "T'001" },
            ":sk1": { S: "2025-01-01" },
            ":sk2": { S: "2025-12-31" },
            ":status": { S: "PENDING" },
            ":note": { S: "urgent" },
          },
          ScanIndexForward: false,
          Limit: 100,
        },
        sortKeyName: "createdAt",
      })
    ).toBe(`SELECT "tenantId", "total amount"
FROM "order""table"."status-index"
WHERE "tenantId" = 'T''001' AND "createdAt" BETWEEN '2025-01-01' AND '2025-12-31' AND "status" = 'PENDING' AND contains("note", 'urgent')
ORDER BY "createdAt" DESC
LIMIT 100;`);
  });

  it("uses SELECT * and preserves numeric and boolean types", () => {
    expect(
      buildDynamoPartiqlSelect({
        input: {
          TableName: "orders",
          KeyConditionExpression: "#pk = :pk",
          FilterExpression: "#amount >= :amount AND #active = :active",
          ExpressionAttributeNames: {
            "#pk": "tenantId",
            "#amount": "amount",
            "#active": "active",
          },
          ExpressionAttributeValues: {
            ":pk": { N: "10" },
            ":amount": { N: "1.25e2" },
            ":active": { BOOL: true },
          },
        },
      })
    ).toContain('WHERE "tenantId" = 10 AND "amount" >= 1.25e2 AND "active" = TRUE');
  });

  it("quotes raw values and identifiers even when they already look quoted", () => {
    expect(
      buildDynamoPartiqlSelect({
        input: {
          TableName: '"orders"',
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": '"tenantId"' },
          ExpressionAttributeValues: { ":pk": { S: "'T#001'" } },
        },
      })
    ).toBe(`SELECT *
FROM """orders"""
WHERE """tenantId""" = '''T#001''';`);
  });

  it("does not silently emit an invalid literal for a binary value", () => {
    expect(() =>
      buildDynamoPartiqlSelect({
        input: {
          TableName: "orders",
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": "binaryKey" },
          ExpressionAttributeValues: { ":pk": { B: "AQID" } },
        },
      })
    ).toThrow("PartiQL has no binary literal syntax");
  });
});
