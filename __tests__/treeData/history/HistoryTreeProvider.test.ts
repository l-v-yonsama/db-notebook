import { describe, expect, it } from "vitest";
import { MarkdownString, ThemeIcon } from "vscode";
import { SQLHistoryItem } from "../../../src/treeData/history/HistoryTreeProvider";
import { SQL_HISTORY_LABEL_MAX_LENGTH } from "../../../src/constant";

describe("SQLHistoryItem", () => {
  it("count/last/total/avg/maxをtooltipへ表示する", () => {
    const item = new SQLHistoryItem({
      id: "h1",
      connectionName: "conn1",
      sqlDoc: "select * from t",
      status: "success",
      performance: {
        sampleCount: 2,
        totalElapsedTimeMilli: 400,
        maxElapsedTimeMilli: 300,
        lastElapsedTimeMilli: 300,
      },
    });

    const tooltip = item.tooltip as MarkdownString;
    expect(tooltip.value).toContain("Ran 2 times");
    expect(tooltip.value).toContain("last 300msec");
    expect(tooltip.value).toContain("total 400msec");
    expect(tooltip.value).toContain("avg 200msec");
    expect(tooltip.value).toContain("max 300msec");
  });

  it("成功結果を保持した再実行エラーを警告表示する", () => {
    const item = new SQLHistoryItem({
      id: "h1",
      connectionName: "conn1",
      sqlDoc: "select * from t",
      status: "success",
      lastErrorMessage: "timeout",
      lastErrorAt: new Date("2026-08-16T00:00:00Z").getTime(),
    });

    expect(item.contextValue).toBe("sqlHistorySuccess");
    expect((item.iconPath as ThemeIcon).id).toBe("warning");
    expect((item.tooltip as MarkdownString).value).toContain("Last retry failed");
    expect((item.tooltip as MarkdownString).value).toContain("timeout");
  });

  it("native Query history shows 'items', not 'rows', and a values-free json tooltip", () => {
    const item = new SQLHistoryItem({
      id: "h2",
      connectionName: "local-dynamo",
      sqlDoc: "DDB orders_with…characters · K tenantId = … · F status = …",
      status: "success",
      request: {
        kind: "dynamodbQuery",
        origin: "dynamoQueryPanel",
        structuralKey: "k",
        displayText: "DDB orders_with…characters · K tenantId = … · F status = …",
        input: {
          TableName: "orders",
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": "tenantId" },
          ExpressionAttributeValues: { ":pk": { S: "secret-tenant-value" } },
        },
      },
      summary: {
        info: "70 items returned",
        elapsedTimeMilli: 12,
        selectedRows: 70,
        dynamoDb: { apiOperation: "Query", returnedItemCount: 70 },
      } as any,
    });

    expect(item.description).toContain("70 items");
    expect(item.description).not.toContain("rows");
    expect(item.contextValue).toBe("sqlHistoryDynamoQueryPanelSuccess");
    expect(item.label).toContain("· F status = …");

    const tooltip = (item.tooltip as MarkdownString).value;
    expect(tooltip).not.toContain("```sql");
    expect(tooltip).toContain("```text");
    expect(tooltip).toContain("```json");
    expect(tooltip).not.toContain("secret-tenant-value");
    expect(tooltip).toContain("tableName");
    expect(tooltip).toContain('"tableName"');
    expect(tooltip).not.toContain("&quot;");
  });

  it("a plain SQL/PartiQL history entry (no request field) still shows 'rows' and an sql fence", () => {
    const item = new SQLHistoryItem({
      id: "h3",
      connectionName: "conn1",
      sqlDoc: 'select "tenantId" from "orders"',
      status: "success",
      meta: { type: "select" } as any,
      summary: { info: "1 row", elapsedTimeMilli: 1, selectedRows: 1 } as any,
    });

    expect(item.description).toContain("1 row");
    const tooltip = (item.tooltip as MarkdownString).value;
    expect(tooltip).toContain("```sql");
    expect(tooltip).toContain('select "tenantId" from "orders"');
    expect(tooltip).not.toContain("&quot;");
  });

  it("applies the shared label length limit to RDB SQL and DynamoDB PartiQL histories", () => {
    for (const sqlDoc of [
      "SELECT tenant_id, order_id, status, created_at FROM application_orders WHERE tenant_id = 'T#001' ORDER BY created_at DESC",
      'SELECT * FROM "dynamo_performance_lab_orders" WHERE "tenantId" = \'T#001\' AND "status" = \'PENDING\'',
    ]) {
      const item = new SQLHistoryItem({
        id: sqlDoc,
        connectionName: "conn1",
        sqlDoc,
        status: "success",
      });
      expect(String(item.label).length).toBeLessThanOrEqual(SQL_HISTORY_LABEL_MAX_LENGTH);
    }
  });
});
