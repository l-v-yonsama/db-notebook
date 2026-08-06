import {
  CancellationTokenSource,
  NotebookCellData,
  NotebookCellKind,
  NotebookData,
  Uri,
  window,
  workspace,
} from "vscode";
import { DBNotebookSerializer } from "../notebook/serializer";
import { showWindowErrorMessage } from "./alertUtil";

export const CFN_DIAGRAM_PREVIEW_FILE_NAME = "preview.cfn-diagram.dbn";

/**
 * Writes (or updates) a single, fixed-name notebook - `preview.cfn-diagram.dbn` at the
 * workspace root - with the given Mermaid content as its first cell, then opens it. Unlike
 * CREATE_NEW_NOTEBOOK (an untitled, in-memory notebook the user has to save themselves), this
 * is a real file on disk that gets reused across repeated "regenerate the diagram" runs from
 * CfnDiagramSettingsPanel, rather than piling up a new untitled tab every time.
 *
 * Reuses DBNotebookSerializer directly for the on-disk JSON shape instead of re-implementing
 * it here, so this stays in sync with whatever `.dbn` actually looks like.
 *
 * - No existing file: created with exactly one Markdown cell.
 * - Existing file, first cell is already Markdown: that cell's content is replaced.
 * - Existing file, first cell is something else (or the file has no cells): a new Markdown
 *   cell is inserted at index 0. Every other cell is left untouched either way.
 */
export async function upsertCfnDiagramPreviewNotebook(markdownContent: string): Promise<void> {
  const wsFolder = workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    showWindowErrorMessage(
      `Open a workspace folder first - ${CFN_DIAGRAM_PREVIEW_FILE_NAME} is created relative to it.`
    );
    return;
  }
  const uri = Uri.joinPath(wsFolder.uri, CFN_DIAGRAM_PREVIEW_FILE_NAME);
  const serializer = new DBNotebookSerializer();
  const token = new CancellationTokenSource().token;
  const newCell = new NotebookCellData(NotebookCellKind.Markup, markdownContent, "markdown");

  let notebookData: NotebookData;
  const existingBytes = await readFileIfExists(uri);
  if (existingBytes) {
    notebookData = await serializer.deserializeNotebook(existingBytes, token);
    const firstCell = notebookData.cells[0];
    if (firstCell?.kind === NotebookCellKind.Markup) {
      notebookData.cells[0] = newCell;
    } else {
      notebookData.cells.unshift(newCell);
    }
  } else {
    notebookData = new NotebookData([newCell]);
  }

  const bytes = await serializer.serializeNotebook(notebookData, token);
  await workspace.fs.writeFile(uri, bytes);

  const doc = await workspace.openNotebookDocument(uri);
  await window.showNotebookDocument(doc);
}

async function readFileIfExists(uri: Uri): Promise<Uint8Array | undefined> {
  try {
    return await workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
}
