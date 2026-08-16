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
});
