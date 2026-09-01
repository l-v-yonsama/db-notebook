import type { IndexDefinition, PerformanceTuningContext, TableTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { findPossibleDuplicateIndex } from "../../../src/performanceTuning/ai/performanceTuningIndexDuplication";

function table(overrides: Partial<TableTuningContext> & { indexes: IndexDefinition[] }): TableTuningContext {
  const { indexes, ...rest } = overrides;
  return {
    tableName: "products",
    definition: {
      columns: [],
      constraints: [],
      indexes,
    },
    ...rest,
  };
}

function buildContext(tables: TableTuningContext[]): PerformanceTuningContext {
  return {
    formatVersion: 1,
    database: { vendor: "postgresql", databaseName: "app" },
    statement: { sql: "SELECT 1", source: "editor" },
    executionPlan: { mode: "estimate", format: "json" },
    tables,
    planTableMappings: [],
    collection: { collectedAt: "2026-08-21T00:00:00.000Z", status: "complete", diagnostics: [], unavailableSections: [] },
  };
}

describe("findPossibleDuplicateIndex", () => {
  it("flags an exact single-column duplicate (the idx_products_category regression from summary.md, verbatim)", () => {
    const context = buildContext([
      table({
        tableName: "products",
        schemaName: "performance_lab",
        indexes: [{ indexName: "idx_products_category", unique: false, columns: [{ columnName: "category" }] }],
      }),
    ]);
    const match = findPossibleDuplicateIndex(
      "CREATE INDEX idx_products_category ON performance_lab.products (category);",
      context,
    );
    expect(match).toEqual({ schemaName: "performance_lab", tableName: "products", matchedIndexName: "idx_products_category" });
  });

  it("flags an exact multi-column composite duplicate", () => {
    const context = buildContext([
      table({
        tableName: "orders",
        indexes: [
          {
            indexName: "idx_orders_tenant_status_created_at",
            unique: false,
            columns: [{ columnName: "tenant_id" }, { columnName: "status" }, { columnName: "created_at" }],
          },
        ],
      }),
    ]);
    const match = findPossibleDuplicateIndex(
      "CREATE INDEX idx2 ON orders (tenant_id, status, created_at);",
      context,
    );
    expect(match?.matchedIndexName).toBe("idx_orders_tenant_status_created_at");
  });

  it("flags an expression-column duplicate, normalizing case/whitespace (LOWER(channel) vs stored lower(channel))", () => {
    const context = buildContext([
      table({
        tableName: "orders",
        indexes: [{ indexName: "idx_orders_channel_lower", unique: false, columns: [{ expression: "lower(channel)" }] }],
      }),
    ]);
    const match = findPossibleDuplicateIndex(
      "CREATE INDEX idx_new ON orders (LOWER( channel ));",
      context,
    );
    expect(match?.matchedIndexName).toBe("idx_orders_channel_lower");
  });

  it("does NOT flag the same columns in a different order (deliberately narrow: verbatim duplicates only)", () => {
    const context = buildContext([
      table({
        tableName: "orders",
        indexes: [{ indexName: "idx_a", unique: false, columns: [{ columnName: "status" }, { columnName: "created_at" }] }],
      }),
    ]);
    const match = findPossibleDuplicateIndex(
      "CREATE INDEX idx_b ON orders (created_at, status);",
      context,
    );
    expect(match).toBeUndefined();
  });

  it("does NOT flag a different table even with an identically-named/columned index", () => {
    const context = buildContext([
      table({
        tableName: "customers",
        indexes: [{ indexName: "idx_a", unique: false, columns: [{ columnName: "category" }] }],
      }),
    ]);
    const match = findPossibleDuplicateIndex("CREATE INDEX idx_b ON products (category);", context);
    expect(match).toBeUndefined();
  });

  it("returns undefined for a non-CREATE INDEX suggestedQuery, or none at all, without throwing", () => {
    const context = buildContext([
      table({ tableName: "orders", indexes: [{ indexName: "idx_a", unique: false, columns: [{ columnName: "status" }] }] }),
    ]);
    expect(findPossibleDuplicateIndex(undefined, context)).toBeUndefined();
    expect(findPossibleDuplicateIndex("", context)).toBeUndefined();
    expect(
      findPossibleDuplicateIndex(
        "Rewrite the predicate to be sargable: created_at >= X AND created_at < Y",
        context,
      ),
    ).toBeUndefined();
    expect(findPossibleDuplicateIndex("ALTER TABLE orders ADD COLUMN foo int;", context)).toBeUndefined();
  });

  it("resolves a schema-qualified candidate against an unqualified table entry, and vice versa", () => {
    const context = buildContext([
      table({
        tableName: "products",
        indexes: [{ indexName: "idx_products_category", unique: false, columns: [{ columnName: "category" }] }],
      }),
    ]);
    // context.tables[0] has no schemaName - the candidate's schema-qualified
    // reference should still resolve to it (unqualified side has none to
    // compare against, so it's treated as a match).
    const match = findPossibleDuplicateIndex(
      "CREATE INDEX idx_new ON performance_lab.products (category);",
      context,
    );
    expect(match?.matchedIndexName).toBe("idx_products_category");
  });

  it("does not flag when the table has no definition/indexes collected at all", () => {
    const context = buildContext([{ tableName: "products" }]);
    const match = findPossibleDuplicateIndex("CREATE INDEX idx_new ON products (category);", context);
    expect(match).toBeUndefined();
  });
});
