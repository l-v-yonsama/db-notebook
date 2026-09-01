import type { NotebookCell } from "vscode";
import type { RunResultMetadata } from "../shared/RunResultMetadata";
import type { CellMeta } from "../types/Notebook";
import type { QueryHistory } from "../types/QueryHistory";
import type { StateStorage } from "../utilities/StateStorage";

/**
 * A notebook cell is eligible only after its current SQL text has successfully
 * run and produced a result. The matching query history check is intentionally
 * separate because it is asynchronous.
 */
export function hasSuccessfulSqlCellRun(cell: NotebookCell): boolean {
  const metadata = cell.metadata as CellMeta;
  return (
    cell.document.languageId === "sql" &&
    Boolean(metadata.connectionName) &&
    cell.outputs.some(
      (output) => (output.metadata as RunResultMetadata | undefined)?.status === "executed"
    )
  );
}

/**
 * Finds the Query History entry representing the SQL currently shown in a
 * notebook cell. A failed latest execution never qualifies, even if an older
 * successful history entry with the same text remains available.
 */
export async function findPerformanceTuningHistoryForCell(
  stateStorage: StateStorage,
  cell: NotebookCell
): Promise<QueryHistory | undefined> {
  if (!hasSuccessfulSqlCellRun(cell)) {
    return undefined;
  }

  const { connectionName } = cell.metadata as CellMeta;
  const sqlDoc = cell.document.getText().trim();
  const histories = await stateStorage.getQueryHistoryList();
  return histories.find(
    (history) =>
      history.status !== "error" &&
      history.connectionName === connectionName &&
      history.sqlDoc.trim() === sqlDoc
  );
}
