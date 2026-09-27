import { ConnectionSetting, DbTable, DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { createTableSqlShortcut } from "../../../src/treeData/resource/tableSqlShortcut";

const setting = (dbType: DBType): ConnectionSetting => ({ name: "sample", dbType });

describe("table SQL shortcuts", () => {
  it.each([
    [DBType.MySQL, "`public`.`select`", /LIMIT 100/],
    [DBType.Postgres, '"public"."select"', /LIMIT 100/],
    [DBType.SQLServer, '"public"."select"', /SELECT TOP 100 \*/],
    [DBType.SQLite, '"select"', /LIMIT 100/],
    [DBType.Oracle, '"public"."select"', /FETCH FIRST 100 ROWS ONLY/],
  ] as const)("%s quotes a reserved table name and uses its row limit syntax", (dbType, name, limit) => {
    const table = new DbTable("select", "TABLE");
    table.meta = { schemaName: "public" };
    const result = createTableSqlShortcut(setting(dbType), table, 100);
    expect(result.qualifiedName).toBe(name);
    expect(result.selectSql).toContain(`FROM ${name}`);
    expect(result.selectSql).toMatch(limit);
  });

  it("escapes quotes and spaces independently in the schema and table name", () => {
    const table = new DbTable('line"items', "TABLE");
    table.meta = { schemaName: "sales area" };
    const result = createTableSqlShortcut(setting(DBType.Postgres), table, 20);
    expect(result.qualifiedName).toBe('"sales area"."line""items"');
    expect(result.selectSql).toContain(`FROM ${result.qualifiedName}`);
    expect(result.selectSql).toContain("LIMIT 20");
  });

  it("does not generate SQL for non-relational resources", () => {
    const table = new DbTable("orders", "TABLE");
    expect(() => createTableSqlShortcut(setting(DBType.Redis), table, 100)).toThrow();
  });
});
