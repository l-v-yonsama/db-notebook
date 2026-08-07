import {
  CancellationTokenSource,
  NotebookCellData,
  NotebookCellKind,
  NotebookData,
  Uri,
  ViewColumn,
  commands,
  window,
  workspace,
} from "vscode";
import { DBNotebookSerializer } from "../notebook/serializer";
import { showWindowErrorMessage } from "./alertUtil";
import { readResource, writeBytesToResource, writeToResource } from "./fsUtil";

export const CFN_DIAGRAM_PREVIEW_FILE_NAME = "preview.cfn-diagram.dbn";
export const CFN_DIAGRAM_PREVIEW_DRAWIO_FILE_NAME = "preview.cfn-diagram.drawio";
export const ER_DIAGRAM_PREVIEW_DRAWIO_FILE_NAME = "preview.er-diagram.drawio";
export type CfnTemplatePreview = { stackName: string; source: string };

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
export async function upsertCfnDiagramPreviewNotebook(
  markdownContent: string,
  templates: CfnTemplatePreview[] = []
): Promise<void> {
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
  newCell.metadata = { cfnDiagramPreview: "diagram" };
  const templateCells = templates.map((template) => {
    const cell = new NotebookCellData(
      NotebookCellKind.Markup,
      `## CloudFormation template: ${template.stackName}\n\n\`\`\`yaml\n${template.source}\n\`\`\``,
      "markdown"
    );
    cell.metadata = { cfnDiagramPreview: "template", stackName: template.stackName };
    return cell;
  });

  let notebookData: NotebookData;
  const existingBytes = await readFileIfExists(uri);
  if (existingBytes) {
    notebookData = await serializer.deserializeNotebook(existingBytes, token);
    const hadPreviewCells = notebookData.cells[0]?.metadata?.cfnDiagramPreview === "diagram";
    while (notebookData.cells[0]?.metadata?.cfnDiagramPreview) notebookData.cells.shift();
    if (hadPreviewCells) {
      notebookData.cells.unshift(newCell, ...templateCells);
    } else if (notebookData.cells[0]?.kind === NotebookCellKind.Markup) {
      notebookData.cells[0] = newCell;
      notebookData.cells.splice(1, 0, ...templateCells);
    } else {
      notebookData.cells.unshift(newCell, ...templateCells);
    }
  } else {
    notebookData = new NotebookData([newCell, ...templateCells]);
  }

  const bytes = await serializer.serializeNotebook(notebookData, token);
  await writeBytesToResource(uri, bytes);

  const doc = await workspace.openNotebookDocument(uri);
  await window.showNotebookDocument(doc, { viewColumn: ViewColumn.Two });
}

async function readFileIfExists(uri: Uri): Promise<Uint8Array | undefined> {
  try {
    return Buffer.from(await readResource(uri), "utf8");
  } catch {
    return undefined;
  }
}

/** Writes and opens the fixed-name editable diagrams.net XML preview. */
export async function upsertCfnDiagramPreviewDrawio(drawioContent: string): Promise<void> {
  await upsertDrawioPreview(drawioContent, CFN_DIAGRAM_PREVIEW_DRAWIO_FILE_NAME);
}

export async function upsertERDiagramPreviewDrawio(drawioContent: string): Promise<void> {
  await upsertDrawioPreview(drawioContent, ER_DIAGRAM_PREVIEW_DRAWIO_FILE_NAME);
}

async function upsertDrawioPreview(drawioContent: string, fileName: string): Promise<void> {
  const wsFolder = workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    showWindowErrorMessage(
      `Open a workspace folder first - ${fileName} is created relative to it.`
    );
    return;
  }
  const uri = Uri.joinPath(wsFolder.uri, fileName);
  await writeToResource(uri, drawioContent);
  try {
    await commands.executeCommand(
      "vscode.openWith",
      uri,
      "hediet.vscode-drawio-text",
      { viewColumn: ViewColumn.Two }
    );
  } catch {
    await window.showInformationMessage(
      `Draw.io file created, but the Draw.io editor could not be opened: ${uri.fsPath}`
    );
  }
}
