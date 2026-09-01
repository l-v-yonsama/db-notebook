import { NotebookCellData, Uri, ViewColumn, workspace } from "vscode";
import { openNotebookFile, writeNotebookFile } from "../../notebook/notebookFileUtil";
import { createDirectory, existsUri } from "../../utilities/fsUtil";

const REPORTS_SUBPATH = ["reports", "performance-tuning"] as const;

export type SavePerformanceTuningNotebookResult =
  | { ok: true; relativePath: string; uri: Uri }
  | { ok: false; message: string };

export async function savePerformanceTuningNotebookFile(params: {
  filename: string;
  cells: NotebookCellData[];
}): Promise<SavePerformanceTuningNotebookResult> {
  const wsFolder = workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    return {
      ok: false,
      message:
        "No workspace folder is open, so the performance tuning report cannot be saved. Open a workspace folder and try again.",
    };
  }

  const dirUri = Uri.joinPath(wsFolder.uri, ...REPORTS_SUBPATH);
  await createDirectory(dirUri);

  let { filename } = params;
  let targetUri = Uri.joinPath(dirUri, filename);
  if (await existsUri(targetUri)) {
    filename = filename.replace(/\.dbn$/, `-${Date.now()}.dbn`);
    targetUri = Uri.joinPath(dirUri, filename);
  }

  await writeNotebookFile(params.cells, targetUri);
  await openNotebookFile(targetUri, { viewColumn: ViewColumn.Two });
  return { ok: true, relativePath: [...REPORTS_SUBPATH, filename].join("/"), uri: targetUri };
}
