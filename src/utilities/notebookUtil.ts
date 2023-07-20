import { NotebookCell, NotebookCellKind, NotebookDocument, Uri, workspace } from "vscode";
import { CellMeta } from "../types/Notebook";
import { RecordRule } from "../shared/RecordRule";
import { readFileOnStorage } from "./fsUtil";
import { CodeResolverParams } from "../shared/CodeResolverParams";
import { TopLevelCondition } from "json-rules-engine";
import {
  ResultSetData,
  stringConditionToJsonCondition,
} from "@l-v-yonsama/multi-platform-database-drivers";

export const isSqlCell = (cell: NotebookCell): boolean => {
  return cell.kind === NotebookCellKind.Code && cell.document.languageId === "sql";
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
