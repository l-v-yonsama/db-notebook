import { NotebookCell, NotebookCellKind, NotebookEditor, window } from "vscode";
import { CodeResolverParams } from "../shared/CodeResolverParams";
import { RecordRule } from "../shared/RecordRule";
import { CellMeta, NotebookToolbarClickEvent } from "../types/Notebook";
import { readFileOnWorkspace } from "./fsUtil";

import { stringConditionToJsonCondition } from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import { RunResultMetadata } from "../shared/RunResultMetadata";

export const isSqlCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "sql";
};

export const isJsCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "javascript";
};

export const hasAnyRdhOutputCell = (cell: NotebookCell): boolean => {
  if (!isSqlCell(cell) || cell.outputs.length === 0) {
    return false;
  }
  const meta: RunResultMetadata | undefined = cell.outputs[0].metadata;
  if (!meta) {
    return false;
  }
  if (meta.rdh === undefined && meta.explainRdh === undefined && meta.analyzedRdh === undefined) {
    return false;
  }
  return true;
};

export const isJsonCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "json";
};

export const isPreExecution = (cell: NotebookCell): boolean => {
  if (!isJsonCell(cell)) {
    return false;
  }
  const meta = cell.metadata as CellMeta;
  if (meta.markAsRunInOrderAtJsonCell === true) {
    return false;
  }
  return true;
};

export const readRuleFile = async (
  metadata: CellMeta,
  rdh: ResultSetData
): Promise<RecordRule | undefined> => {
  const { ruleFile } = metadata;
  if (ruleFile) {
    const text = await readFileOnWorkspace(ruleFile);
    if (text) {
      const rule = JSON.parse(text) as RecordRule;
      rule.tableRule.details.forEach((detail) => {
        stringConditionToJsonCondition(detail.conditions, rdh.keys);
      });
      return rule;
    }
  }
  return undefined;
};

export const readCodeResolverFile = async (
  metadata: CellMeta
): Promise<CodeResolverParams | undefined> => {
  const { codeResolverFile } = metadata;
  if (codeResolverFile) {
    const text = await readFileOnWorkspace(codeResolverFile);
    if (text) {
      return JSON.parse(text) as CodeResolverParams;
    }
  }
  return undefined;
};

export const getToolbarButtonClickedNotebookEditor = (
  e: NotebookToolbarClickEvent
): NotebookEditor | undefined => {
  return window.visibleNotebookEditors.find(
    (it) => it.notebook.uri.toString() === e.notebookEditor.notebookUri.toString()
  );
};

export const getSelectedCells = (options?: {
  onlySql?: boolean;
  onlyJs?: boolean;
  onlyCode?: boolean;
}): NotebookCell[] => {
  const editor = window.activeNotebookEditor;
  if (editor === undefined || editor.selection.isEmpty) {
    return [];
  }
  const cells = editor.notebook.getCells(editor.selection);
  if (options) {
    if (options.onlySql) {
      return cells.filter((it) => isSqlCell(it));
    }
    if (options.onlySql) {
      return cells.filter((it) => isJsCell(it));
    }
    if (options.onlyCode) {
      return cells.filter((it) => it.kind === NotebookCellKind.Code);
    }
  }
  return cells;
};
