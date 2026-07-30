import * as path from "path";
import {
  CancellationToken,
  Disposable,
  ExtensionContext,
  NotebookCell,
  TextDocumentContentProvider,
  Uri,
  workspace,
} from "vscode";
import { JS_VIRTUAL_DOC_SCHEME } from "../../constant";
import { getEmbeddablePreludeText } from "./preludeSource";

/**
 * Derives the virtual document URI forwarded to the built-in TS language service for a
 * given real JS cell. Pure function of the cell's document URI *and* its current
 * `document.version` -- folding the version into the URI means every edit produces a
 * brand-new URI, so VS Code never has a stale cached document to hand back for it. An
 * earlier design kept the URI stable across edits and relied on firing this provider's
 * `onDidChange` before re-opening it, but that raced VS Code's own (asynchronous) refresh
 * of the already-open cached document and could return completions for the previous
 * revision of the cell's text (observed during manual spike testing). `version` never
 * repeats for a given document (it only ever increases, including across undo/redo), so
 * this is collision-free without needing any invalidation event at all.
 */
export const getVirtualUriForCell = (cell: NotebookCell): Uri => {
  const notebookBaseName = path.basename(cell.notebook.uri.fsPath || cell.notebook.uri.path);
  return Uri.from({
    scheme: JS_VIRTUAL_DOC_SCHEME,
    path: `/${notebookBaseName}/cell-${cell.index}.v${cell.document.version}.ts`,
    query: cell.document.uri.toString(),
  });
};

/** Finds the live NotebookCell whose document has the given (real, non-virtual) URI. */
export const findCellByDocumentUri = (documentUri: Uri): NotebookCell | undefined => {
  const target = documentUri.toString();
  for (const notebook of workspace.notebookDocuments) {
    for (let i = 0; i < notebook.cellCount; i++) {
      const cell = notebook.cellAt(i);
      if (cell.document.uri.toString() === target) {
        return cell;
      }
    }
  }
  return undefined;
};

const findRealCell = (virtualUri: Uri): NotebookCell | undefined =>
  findCellByDocumentUri(Uri.parse(virtualUri.query));

class JsVirtualDocumentProvider implements TextDocumentContentProvider {
  provideTextDocumentContent(uri: Uri, _token: CancellationToken): string {
    const prelude = getEmbeddablePreludeText();
    const cell = findRealCell(uri);
    // The owning cell/notebook may have just closed between the request and this call --
    // return the prelude alone rather than throwing, since this must always produce some
    // string.
    if (!cell) {
      return prelude;
    }
    return `${prelude}\n${cell.document.getText()}`;
  }
}

export const registerJsVirtualDocumentProvider = (context: ExtensionContext): Disposable => {
  const disposable = workspace.registerTextDocumentContentProvider(
    JS_VIRTUAL_DOC_SCHEME,
    new JsVirtualDocumentProvider()
  );
  context.subscriptions.push(disposable);
  return disposable;
};
