import type { DbDynamoTable } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { getDynamoDbIndexKeyRoles } from "../../../src/treeData/resource/dynamoDbKeyRoles";

const table = {
  attr: {
    lsi: [
      {
        IndexName: "amount-lsi",
        KeySchema: [
          { AttributeName: "tenantId", KeyType: "HASH" },
          { AttributeName: "totalAmount", KeyType: "RANGE" },
        ],
      },
    ],
    gsi: [
      {
        IndexName: "status-gsi",
        KeySchema: [
          { AttributeName: "tenantStatus", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
      },
      {
        IndexName: "recent-gsi",
        KeySchema: [
          { AttributeName: "category", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
      },
    ],
  },
} as Pick<DbDynamoTable, "attr">;

describe("getDynamoDbIndexKeyRoles", () => {
  it("returns every index role held by one attribute", () => {
    expect(getDynamoDbIndexKeyRoles(table, "createdAt")).toEqual([
      {
        indexType: "GSI",
        indexName: "status-gsi",
        keyType: "SORT KEY",
      },
      {
        indexType: "GSI",
        indexName: "recent-gsi",
        keyType: "SORT KEY",
      },
    ]);
  });

  it("includes the shared LSI/table partition-key role", () => {
    expect(getDynamoDbIndexKeyRoles(table, "tenantId")).toEqual([
      {
        indexType: "LSI",
        indexName: "amount-lsi",
        keyType: "PARTITION KEY",
      },
    ]);
  });

  it("returns no role for an ordinary sampled attribute", () => {
    expect(getDynamoDbIndexKeyRoles(table, "note")).toEqual([]);
  });
});
