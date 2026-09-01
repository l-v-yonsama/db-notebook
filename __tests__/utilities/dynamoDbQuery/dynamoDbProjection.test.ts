import { DbDynamoTable, DbDynamoTableColumn } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  buildDynamoProjectionExpression,
  computeDynamoProjectionConstraint,
  resolveDynamoConsistentRead,
  resolveDynamoProjectionSelection,
  selectionNeedsBaseTableFetch,
} from "../../../src/utilities/dynamoDbQuery/dynamoDbProjection";

const buildTable = (): DbDynamoTable => {
  const table = new DbDynamoTable("orders", {
    lsi: [
      {
        IndexName: "lsiStatus",
        KeySchema: [
          { AttributeName: "tenantId", KeyType: "HASH" },
          { AttributeName: "status", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "INCLUDE", NonKeyAttributes: ["amount"] },
      },
    ],
    gsi: [
      {
        IndexName: "gsiCountryAll",
        KeySchema: [
          { AttributeName: "country", KeyType: "HASH" },
          { AttributeName: "orderId", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "gsiCountryKeysOnly",
        KeySchema: [
          { AttributeName: "country", KeyType: "HASH" },
          { AttributeName: "orderId", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "KEYS_ONLY" },
      },
      {
        IndexName: "gsiUnknownProjection",
        KeySchema: [{ AttributeName: "country", KeyType: "HASH" }],
        Projection: undefined,
      },
    ],
  } as never);
  table.addChild(new DbDynamoTableColumn("tenantId", "S", true, false));
  table.addChild(new DbDynamoTableColumn("orderId", "S", false, true));
  table.addChild(new DbDynamoTableColumn("status", "S", false, false));
  table.addChild(new DbDynamoTableColumn("amount", "N", false, false));
  table.addChild(new DbDynamoTableColumn("country", "S", false, false));
  table.addChild(new DbDynamoTableColumn("notes", "S", false, false));
  return table;
};

describe("computeDynamoProjectionConstraint", () => {
  const table = buildTable();

  it("table: every attribute is projected, allTableAttributes is not offered, consistent read is allowed", () => {
    const c = computeDynamoProjectionConstraint(table, "$table");
    expect(c.projectedAttributes).toEqual(c.availableAttributes);
    expect(c.allowAllTableAttributesOption).toBe(false);
    expect(c.restrictToProjected).toBe(false);
    expect(c.consistentReadAllowed).toBe(true);
  });

  it("LSI: projectedAttributes is table+index keys plus NonKeyAttributes, allTableAttributes is offered, consistent read is allowed", () => {
    const c = computeDynamoProjectionConstraint(table, "$lsi:lsiStatus");
    expect(c.projectedAttributes).toEqual(
      expect.arrayContaining(["tenantId", "orderId", "status", "amount"])
    );
    expect(c.projectedAttributes).not.toContain("country");
    expect(c.projectedAttributes).not.toContain("notes");
    expect(c.allowAllTableAttributesOption).toBe(true);
    expect(c.restrictToProjected).toBe(false);
    expect(c.consistentReadAllowed).toBe(true);
  });

  it("GSI with ProjectionType ALL: every attribute is projected, restrictToProjected is false, consistent read is not allowed", () => {
    const c = computeDynamoProjectionConstraint(table, "$gsi:gsiCountryAll");
    expect(c.projectedAttributes).toEqual(c.availableAttributes);
    expect(c.allowAllTableAttributesOption).toBe(false);
    expect(c.restrictToProjected).toBe(false);
    expect(c.consistentReadAllowed).toBe(false);
  });

  it("GSI with ProjectionType KEYS_ONLY: only key attributes are projected and restrictToProjected is true", () => {
    const c = computeDynamoProjectionConstraint(table, "$gsi:gsiCountryKeysOnly");
    expect(c.projectedAttributes).toEqual(expect.arrayContaining(["country", "orderId", "tenantId"]));
    expect(c.projectedAttributes).not.toContain("amount");
    expect(c.projectedAttributes).not.toContain("notes");
    expect(c.restrictToProjected).toBe(true);
    expect(c.consistentReadAllowed).toBe(false);
  });

  it("GSI with unknown Projection metadata: projectedAttributes is undefined and restrictToProjected is false", () => {
    const c = computeDynamoProjectionConstraint(table, "$gsi:gsiUnknownProjection");
    expect(c.projectedAttributes).toBeUndefined();
    expect(c.restrictToProjected).toBe(false);
  });
});

describe("resolveDynamoProjectionSelection", () => {
  const table = buildTable();

  it("dedupes and drops empty attribute names", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$table");
    const resolved = resolveDynamoProjectionSelection({
      mode: "specific",
      attributes: ["tenantId", "tenantId", "", "status"],
      constraint,
    });
    expect(resolved.attributes.sort()).toEqual(["status", "tenantId"]);
  });

  it("downgrades allTableAttributes to default when not allowed (table/GSI)", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$table");
    const resolved = resolveDynamoProjectionSelection({
      mode: "allTableAttributes",
      attributes: [],
      constraint,
    });
    expect(resolved.mode).toBe("default");
  });

  it("keeps allTableAttributes for an LSI", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$lsi:lsiStatus");
    const resolved = resolveDynamoProjectionSelection({
      mode: "allTableAttributes",
      attributes: [],
      constraint,
    });
    expect(resolved.mode).toBe("allTableAttributes");
  });

  it("filters out non-projected attributes for a restrict-to-projected GSI, and rejects a forged selection", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$gsi:gsiCountryKeysOnly");
    const resolved = resolveDynamoProjectionSelection({
      mode: "specific",
      attributes: ["country", "amount"],
      constraint,
    });
    expect(resolved.attributes).toEqual(["country"]);
  });

  it("keeps specific as an editable invalid state when every selected attribute was filtered out", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$gsi:gsiCountryKeysOnly");
    const resolved = resolveDynamoProjectionSelection({
      mode: "specific",
      attributes: ["amount"],
      constraint,
    });
    expect(resolved.mode).toBe("specific");
    expect(resolved.attributes).toEqual([]);
  });

  it("keeps a non-projected LSI attribute selected (allowed, just needs a base-table fetch)", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$lsi:lsiStatus");
    const resolved = resolveDynamoProjectionSelection({
      mode: "specific",
      attributes: ["notes"],
      constraint,
    });
    expect(resolved.mode).toBe("specific");
    expect(resolved.attributes).toEqual(["notes"]);
  });

  it("clears attributes for default mode", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$table");
    const resolved = resolveDynamoProjectionSelection({
      mode: "default",
      attributes: ["tenantId"],
      constraint,
    });
    expect(resolved.attributes).toEqual([]);
  });
});

describe("resolveDynamoConsistentRead", () => {
  const table = buildTable();

  it("keeps true for table/LSI", () => {
    expect(
      resolveDynamoConsistentRead(true, computeDynamoProjectionConstraint(table, "$table"))
    ).toBe(true);
    expect(
      resolveDynamoConsistentRead(true, computeDynamoProjectionConstraint(table, "$lsi:lsiStatus"))
    ).toBe(true);
  });

  it("forces false for a GSI even when the caller asked for true (forged webview message)", () => {
    expect(
      resolveDynamoConsistentRead(true, computeDynamoProjectionConstraint(table, "$gsi:gsiCountryAll"))
    ).toBe(false);
  });
});

describe("buildDynamoProjectionExpression", () => {
  it("default mode sets neither Select nor ProjectionExpression", () => {
    const r = buildDynamoProjectionExpression("default", []);
    expect(r.select).toBeUndefined();
    expect(r.projectionExpression).toBeUndefined();
    expect(r.expressionAttributeNames).toEqual({});
  });

  it("allTableAttributes sets Select: ALL_ATTRIBUTES only", () => {
    const r = buildDynamoProjectionExpression("allTableAttributes", []);
    expect(r.select).toBe("ALL_ATTRIBUTES");
    expect(r.projectionExpression).toBeUndefined();
  });

  it("specific mode aliases every attribute, never interpolating the raw name", () => {
    const r = buildDynamoProjectionExpression("specific", ["tenantId", "order id", "Reserved"]);
    expect(r.projectionExpression).toBe("#p0, #p1, #p2");
    expect(r.expressionAttributeNames).toEqual({
      "#p0": "tenantId",
      "#p1": "order id",
      "#p2": "Reserved",
    });
  });

  it("specific mode with no attributes behaves like default", () => {
    const r = buildDynamoProjectionExpression("specific", []);
    expect(r.select).toBeUndefined();
    expect(r.projectionExpression).toBeUndefined();
  });
});

describe("selectionNeedsBaseTableFetch", () => {
  const table = buildTable();

  it("is true for an LSI selection that includes a non-projected attribute", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$lsi:lsiStatus");
    expect(selectionNeedsBaseTableFetch("specific", ["notes"], constraint)).toBe(true);
  });

  it("is false for an LSI selection made entirely of projected attributes", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$lsi:lsiStatus");
    expect(selectionNeedsBaseTableFetch("specific", ["amount"], constraint)).toBe(false);
  });

  it("is false for default and true for LSI allTableAttributes when its projection is partial", () => {
    const constraint = computeDynamoProjectionConstraint(table, "$lsi:lsiStatus");
    expect(selectionNeedsBaseTableFetch("default", [], constraint)).toBe(false);
    expect(selectionNeedsBaseTableFetch("allTableAttributes", [], constraint)).toBe(true);
  });
});
