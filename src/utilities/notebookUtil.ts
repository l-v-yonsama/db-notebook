import { NotebookCell, NotebookCellKind, NotebookDocument, Uri, workspace } from "vscode";
import { CellMeta } from "../types/Notebook";
import path = require("path");
import { RecordRule } from "../shared/RecordRule";

export const isSqlCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "sql";
};

export const isJsonCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "json";
};

export const existsRuleFile = async (ruleFile: string): Promise<boolean> => {
  if (ruleFile) {
    let wsfolder = workspace.workspaceFolders?.[0].uri;
    if (!wsfolder) {
      return false;
    }
    const rootPath = wsfolder.fsPath;
    try {
      const filePath = path.join(rootPath, ruleFile);
      await workspace.fs.stat(Uri.file(filePath));
      return true;
    } catch (_) {
      return false;
    }
  }
  return false;
};

export const readRuleFile = async (cell: NotebookCell): Promise<RecordRule | undefined> => {
  const { ruleFile }: CellMeta = cell.metadata;
  if (ruleFile) {
    let wsfolder = workspace.workspaceFolders?.[0].uri;
    if (!wsfolder) {
      return undefined;
    }
    const rootPath = wsfolder.fsPath;
    try {
      const filePath = path.join(rootPath, ruleFile);
      const readData = await workspace.fs.readFile(Uri.file(filePath));
      return JSON.parse(Buffer.from(readData).toString("utf8"));
    } catch (_) {
      return undefined;
    }
  }
  return undefined;
};
