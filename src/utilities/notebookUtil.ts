import { NotebookCell, NotebookCellKind, NotebookDocument, Uri, workspace } from "vscode";
import { CellMeta } from "../types/Notebook";
import { RecordRule } from "../shared/RecordRule";
import { readFileOnStorage } from "./fsUtil";

export const isSqlCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "sql";
};

export const isJsonCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "json";
};

export const readRuleFile = async (cell: NotebookCell): Promise<RecordRule | undefined> => {
  const { ruleFile }: CellMeta = cell.metadata;
  if (ruleFile) {
    const text = await readFileOnStorage(ruleFile);
    if (text) {
      return JSON.parse(text) as RecordRule;
    }
  }
  return undefined;
};
