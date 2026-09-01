import type { NotebookCell } from "vscode";
import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "../../src/utilities/StateStorage";
import {
  findPerformanceTuningHistoryForCell,
  hasSuccessfulSqlCellRun,
} from "../../src/notebook/performanceTuningCell";

const makeCell = (params: {
  sql?: string;
  connectionName?: string;
  status?: "executed" | "error";
} = {}): NotebookCell => {
  const { sql = "SELECT * FROM orders", connectionName = "app", status = "executed" } = params;
  return {
    metadata: { connectionName },
    outputs: [{ metadata: { status } }],
    document: {
      languageId: "sql",
      getText: () => sql,
    },
  } as unknown as NotebookCell;
};

describe("performanceTuningCell", () => {
  it("requires a successful SQL-cell result", () => {
    expect(hasSuccessfulSqlCellRun(makeCell())).toBe(true);
    expect(hasSuccessfulSqlCellRun(makeCell({ status: "error" }))).toBe(false);
    expect(hasSuccessfulSqlCellRun(makeCell({ connectionName: "" }))).toBe(false);
  });

  it("resolves only the matching successful Query History entry", async () => {
    const matchingHistory = {
      id: "history-1",
      connectionName: "app",
      sqlDoc: " SELECT * FROM orders ",
      status: "success" as const,
    };
    const stateStorage = {
      getQueryHistoryList: vi.fn(async () => [
        { ...matchingHistory, id: "failed", status: "error" as const },
        matchingHistory,
      ]),
    } as unknown as StateStorage;

    await expect(findPerformanceTuningHistoryForCell(stateStorage, makeCell())).resolves.toEqual(
      matchingHistory
    );
    await expect(
      findPerformanceTuningHistoryForCell(stateStorage, makeCell({ sql: "SELECT * FROM customers" }))
    ).resolves.toBeUndefined();
  });
});
