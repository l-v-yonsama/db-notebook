import { describe, expect, it } from "vitest";
import { createDrawioErDiagram } from "../../src/utilities/erDiagramDrawioGenerator";

describe("createDrawioErDiagram", () => {
  it("creates an editable draw.io ER diagram with tables and relationships", () => {
    const diagram = createDrawioErDiagram({
      title: "Orders",
      tableItems: [
        {
          tableRes: {
            name: "orders",
            comment: "Orders",
            children: [
              { name: "id", colType: "integer", primaryKey: true, nullable: false },
              { name: "customer_id", colType: "integer", nullable: false },
            ],
            foreignKeys: { referenceTo: { customer_id: { tableName: "customers" } } },
          } as any,
          columnNames: ["id", "customer_id"],
        },
        {
          tableRes: {
            name: "customers",
            comment: "Customers",
            children: [{ name: "id", colType: "integer", primaryKey: true, nullable: false }],
            foreignKeys: {},
          } as any,
          columnNames: ["id"],
        },
      ],
      relations: [{
        name: "orders_customer_fk",
        dotted: false,
        referencedFrom: { tableName: "orders", columnName: "customer_id", cardinality: ">=1" },
        referenceTo: { tableName: "customers", columnName: "id", cardinality: "1" },
      }],
    });

    const ids = [...diagram.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const counts = ids.reduce<Record<string, number>>((result, id) => {
      result[id] = (result[id] ?? 0) + 1;
      return result;
    }, {});

    expect(diagram).toContain('name="ER Diagram"');
    expect(diagram).toContain("orders_customer_fk");
    expect(diagram).toContain('id="table_0_key_0" value="PK"');
    expect(diagram).toContain('id="table_0_key_1" value="FK NN"');
    expect(diagram).toContain('id="table_0_column_0" value="id: INTEGER"');
    expect(diagram).not.toContain("NOT NULL");
    expect(Object.entries(counts).filter(([, count]) => count > 1)).toEqual([]);
  });
});
