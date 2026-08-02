import * as path from "path";
import { NotebookDocument, Uri, workspace } from "vscode";
import { getErrorMessage } from "../../utilities/errorUtil";
import { existsUri } from "../../utilities/fsUtil";

export type NotebookPathResolution = { ok: true; uri: Uri } | { ok: false; message: string };

const NOTEBOOK_EXTENSION = ".dbn";

/**
 * Resolves a model-supplied path string to a target Uri for a .dbn notebook.
 * Absolute paths are used as-is; relative paths are resolved against the
 * first workspace folder (same convention as fsUtil.ts's
 * existsFileOnWorkspace/readFileOnWorkspace).
 */
export function resolveNotebookTargetUri(notebookPath: string): NotebookPathResolution {
  if (!notebookPath || notebookPath.trim().length === 0) {
    return { ok: false, message: "notebookPath must not be empty." };
  }

  const withExtension = notebookPath.endsWith(NOTEBOOK_EXTENSION)
    ? notebookPath
    : `${notebookPath}${NOTEBOOK_EXTENSION}`;

  if (path.isAbsolute(withExtension)) {
    return { ok: true, uri: Uri.file(withExtension) };
  }

  const wsFolder = workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    return {
      ok: false,
      message: `No workspace folder is open, so relative notebookPath "${notebookPath}" cannot be resolved. Open a workspace folder or provide an absolute path.`,
    };
  }

  return { ok: true, uri: Uri.joinPath(wsFolder.uri, withExtension) };
}

/** Finds an already-open notebook document at the given uri, regardless of dirty state. */
export function findOpenNotebookDocument(uri: Uri): NotebookDocument | undefined {
  return workspace.notebookDocuments.find((doc) => doc.uri.toString() === uri.toString());
}

export type NotebookDocumentResolution =
  | { ok: true; document: NotebookDocument }
  | { ok: false; message: string };

/**
 * Resolves a live NotebookDocument for an existing .dbn file: prefers an
 * already-open document (so unsaved edits aren't clobbered by a disk read),
 * falling back to opening the saved file.
 */
export async function resolveNotebookDocument(uri: Uri): Promise<NotebookDocumentResolution> {
  const open = findOpenNotebookDocument(uri);
  if (open) {
    return { ok: true, document: open };
  }

  if (!(await existsUri(uri))) {
    return { ok: false, message: `No notebook found at "${uri.fsPath}".` };
  }

  try {
    const document = await workspace.openNotebookDocument(uri);
    return { ok: true, document };
  } catch (e) {
    return { ok: false, message: `Failed to open notebook "${uri.fsPath}": ${getErrorMessage(e)}` };
  }
}
