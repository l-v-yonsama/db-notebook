import { describe, expect, it } from "vitest";
import { MarkdownString, ThemeIcon } from "vscode";
import { SQLHistoryItem } from "../../../src/treeData/history/HistoryTreeProvider";

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
      sqlDoc: "DynamoDB Query orders\nKey: #pk = :pk",
      status: "success",
      request: {
        kind: "dynamodbQuery",
        origin: "dynamoQueryPanel",
        structuralKey: "k",
        displayText: "DynamoDB Query orders\nKey: #pk = :pk",
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

    const tooltip = (item.tooltip as MarkdownString).value;
    expect(tooltip).not.toContain("```sql");
    expect(tooltip).toContain("```text");
    expect(tooltip).toContain("```json");
    expect(tooltip).not.toContain("secret-tenant-value");
    expect(tooltip).toContain("tableName");
  });

  it("a plain SQL/PartiQL history entry (no request field) still shows 'rows' and an sql fence", () => {
    const item = new SQLHistoryItem({
      id: "h3",
      connectionName: "conn1",
      sqlDoc: "select * from t",
      status: "success",
      meta: { type: "select" } as any,
      summary: { info: "1 row", elapsedTimeMilli: 1, selectedRows: 1 } as any,
    });

    expect(item.description).toContain("1 row");
    expect((item.tooltip as MarkdownString).value).toContain("```sql");
  });
});
