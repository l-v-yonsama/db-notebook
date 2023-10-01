import { NotebookCell, NotebookCellKind, NotebookDocument, Uri, workspace } from "vscode";
import { CellMeta } from "../types/Notebook";
import { RecordRule } from "../shared/RecordRule";
import { readFileOnStorage } from "./fsUtil";
import { CodeResolverParams } from "../shared/CodeResolverParams";

import {
  ResultSetData,
  stringConditionToJsonCondition,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { SQLRunResultMetadata } from "../shared/SQLRunResultMetadata";

export const isSqlCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "sql";
};

export const isJsCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "javascript";
};

export const isSelectOrShowSqlCell = (cell: NotebookCell): boolean => {
  if (!isSqlCell(cell) || cell.outputs.length === 0) {
    return false;
  }
  const meta: SQLRunResultMetadata | undefined = cell.outputs[0].metadata;
  if (!meta) {
    return false;
  }
  return meta.type === "select" || meta.type === "show";
};

export const isJsonCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "json";
};

export const readRuleFile = async (
  cell: NotebookCell,
  rdh: ResultSetData
): Promise<RecordRule | undefined> => {
  const { ruleFile }: CellMeta = cell.metadata;
  if (ruleFile) {
    const text = await readFileOnStorage(ruleFile);
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
  cell: NotebookCell
): Promise<CodeResolverParams | undefined> => {
  const { codeResolverFile }: CellMeta = cell.metadata;
  if (codeResolverFile) {
    const text = await readFileOnStorage(codeResolverFile);
    if (text) {
      return JSON.parse(text) as CodeResolverParams;
    }
  }
  return undefined;
};
