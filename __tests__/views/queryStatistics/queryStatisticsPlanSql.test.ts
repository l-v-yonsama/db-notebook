import {
  DbColumn,
  DbSchema,
  DBType,
  DbTable,
  RdsDatabase,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { GeneralColumnType } from "@l-v-yonsama/rdh";
import { describe, expect, it } from "vitest";
import { selectPlanSql } from "../../../src/views/queryStatistics/queryStatisticsPlanSql";

function buildDatabase(): RdsDatabase {
  const db = new RdsDatabase("app");
  const schema = new DbSchema("app");
  const orders = new DbTable("orders", "TABLE");
  orders.addChild(new DbColumn("id", GeneralColumnType.INTEGER, { nullable: false }));
  orders.addChild(new DbColumn("status", GeneralColumnType.VARCHAR, { nullable: false }));
  schema.addChild(orders);
  db.addChild(schema);
  return db;
}

describe("selectPlanSql", () => {
  it("prefers a complete (no-placeholder) representativeSql over normalizedSql", () => {
    const result = selectPlanSql({
      input: {
        sql: "SELECT * FROM orders WHERE id = ?",
        normalizedSql: "SELECT * FROM orders WHERE id = ?",
        representativeSql: "SELECT * FROM orders WHERE id = 42",
      },
      dbType: DBType.MySQL,
      databaseResource: buildDatabase(),
    });

    expect(result.sql).toBe("SELECT * FROM orders WHERE id = 42");
    expect(result.estimatedBindParameters).toEqual([]);
  });

  it("falls back to normalizedSql when representativeSql still has placeholders (prepared statement)", () => {
    const result = selectPlanSql({
      input: {
        sql: "SELECT * FROM orders WHERE id = ?",
        normalizedSql: "SELECT * FROM orders WHERE id = ?",
        representativeSql: "SELECT * FROM orders WHERE id = ?",
      },
      dbType: DBType.MySQL,
      databaseResource: buildDatabase(),
    });

    expect(result.sql).toBe("SELECT * FROM orders WHERE id = ?");
    expect(result.estimatedBindParameters).toHaveLength(1);
  });

  it("falls back to normalizedSql when representativeSql is missing", () => {
    const result = selectPlanSql({
      input: {
        sql: "SELECT * FROM orders WHERE id = ?",
        normalizedSql: "SELECT * FROM orders WHERE id = ?",
      },
      dbType: DBType.MySQL,
      databaseResource: buildDatabase(),
    });

    expect(result.sql).toBe("SELECT * FROM orders WHERE id = ?");
    expect(result.estimatedBindParameters).toHaveLength(1);
  });

  it("falls back to normalizedSql when representativeSql is a suspected truncation", () => {
    const result = selectPlanSql({
      input: {
        sql: "SELECT * FROM orders WHERE id = ?",
        normalizedSql: "SELECT * FROM orders WHERE id = ?",
        representativeSql: "SELECT * FROM orders WHERE id = 42",
        representativeSqlMayBeTruncated: true,
      },
      dbType: DBType.MySQL,
      databaseResource: buildDatabase(),
    });

    expect(result.sql).toBe("SELECT * FROM orders WHERE id = ?");
    expect(result.estimatedBindParameters).toHaveLength(1);
  });

  it("falls back to sql when normalizedSql is missing", () => {
    const result = selectPlanSql({
      input: { sql: "SELECT * FROM orders WHERE id = ?" },
      dbType: DBType.MySQL,
      databaseResource: buildDatabase(),
    });

    expect(result.sql).toBe("SELECT * FROM orders WHERE id = ?");
    expect(result.estimatedBindParameters).toHaveLength(1);
  });

  it("resolves the estimated column/type against the given databaseResource", () => {
    const result = selectPlanSql({
      input: { sql: "SELECT * FROM orders WHERE status = ?" },
      dbType: DBType.MySQL,
      databaseResource: buildDatabase(),
    });

    expect(result.estimatedBindParameters[0].estimatedColumn).toBe("app.orders.status");
    expect(result.estimatedBindParameters[0].estimatedType).toBe(GeneralColumnType.VARCHAR);
  });

  it("returns no bind rows for a fully literal SQL", () => {
    const result = selectPlanSql({
      input: { sql: "SELECT * FROM orders WHERE id = 42" },
      dbType: DBType.MySQL,
      databaseResource: buildDatabase(),
    });

    expect(result.sql).toBe("SELECT * FROM orders WHERE id = 42");
    expect(result.estimatedBindParameters).toEqual([]);
  });
});
