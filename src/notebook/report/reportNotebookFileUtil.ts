import { CancellationTokenSource, NotebookData, Uri, ViewColumn, window, workspace } from "vscode";
import { createDirectory, existsUri, writeBytesToResource } from "../../utilities/fsUtil";
import { DBNotebookReportSerializer } from "./reportSerializer";

const CLOUDWATCH_REPORTS_SUBPATH = ["reports", "cw-metrics"] as const;

export type SaveReportNotebookResult =
  | { ok: true; relativePath: string; uri: Uri }
  | { ok: false; message: string };

export async function writeAndOpenReportNotebook(
  report: NotebookData,
  targetUri: Uri,
  options?: { viewColumn?: ViewColumn }
): Promise<void> {
  const tokenSource = new CancellationTokenSource();
  try {
    const bytes = await new DBNotebookReportSerializer().serializeNotebook(
      report,
      tokenSource.token
    );
    await writeBytesToResource(targetUri, bytes);
  } finally {
    tokenSource.dispose();
  }
  const document = await workspace.openNotebookDocument(targetUri);
  await window.showNotebookDocument(
    document,
    options?.viewColumn ? { viewColumn: options.viewColumn } : undefined
  );
}

export async function saveCloudWatchReportNotebook(
  report: NotebookData,
  filename: string
): Promise<SaveReportNotebookResult> {
  const wsFolder = workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    return {
      ok: false,
      message:
        "No workspace folder is open, so the CloudWatch metrics report cannot be saved. Open a workspace folder and try again.",
    };
  }

  const dirUri = Uri.joinPath(wsFolder.uri, ...CLOUDWATCH_REPORTS_SUBPATH);
  await createDirectory(dirUri);
  let resolvedFilename = filename;
  let targetUri = Uri.joinPath(dirUri, resolvedFilename);
  if (await existsUri(targetUri)) {
    resolvedFilename = filename.replace(/\.dbnr$/, `-${Date.now()}.dbnr`);
    targetUri = Uri.joinPath(dirUri, resolvedFilename);
  }
  await writeAndOpenReportNotebook(report, targetUri, { viewColumn: ViewColumn.Two });
  return {
    ok: true,
    relativePath: [...CLOUDWATCH_REPORTS_SUBPATH, resolvedFilename].join("/"),
    uri: targetUri,
  };
}
