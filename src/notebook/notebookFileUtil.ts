import {
  CancellationTokenSource,
  NotebookCellData,
  NotebookData,
  Uri,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import { writeBytesToResource } from "../utilities/fsUtil";
import { DBNotebookSerializer } from "./serializer";

/**
 * Shared "build a .dbn file from cells, then open it" plumbing used by any command that
 * generates a ready-to-use notebook on disk (the SQLite demo, template-based notebooks, ...).
 * Originally lived only in sqliteDemo.ts; factored out once a second caller needed the same
 * steps, to keep the serialize/write/open sequence in exactly one place.
 */

/** Builds cells into a `.dbn` file's bytes and writes them to `targetUri`. */
export async function writeNotebookFile(
  cells: NotebookCellData[],
  targetUri: Uri
): Promise<void> {
  const notebookData = new NotebookData(cells);
  const tokenSource = new CancellationTokenSource();
  try {
    const bytes = await new DBNotebookSerializer().serializeNotebook(
      notebookData,
      tokenSource.token
    );
    await writeBytesToResource(targetUri, bytes);
  } finally {
    tokenSource.dispose();
  }
}

/** Opens an existing `.dbn` file, optionally beside the current editor. */
export async function openNotebookFile(
  uri: Uri,
  options?: { viewColumn?: ViewColumn }
): Promise<void> {
  const document = await workspace.openNotebookDocument(uri);
  await window.showNotebookDocument(
    document,
    options?.viewColumn ? { viewColumn: options.viewColumn } : undefined
  );
}
