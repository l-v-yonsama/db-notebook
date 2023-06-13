import { StateStorage } from "../utilities/StateStorage";
import {
  ConnectionSetting,
  DBDriverResolver,
  RDSBaseDriver,
  ResultSetData,
  normalizeQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta, RunResult, NotebookExecutionVariables } from "../types/Notebook";
import { NotebookCell } from "vscode";
import { log } from "../utilities/logger";
import { NodeKernel } from "./NodeKernel";

const PREFIX = "[]";

export const jsonKernelRun = async (
  cell: NotebookCell,
  nodeKernel: NodeKernel
): Promise<RunResult> => {
  let stdout = "";
  let stderr = "";
  let connectionSetting: ConnectionSetting | undefined = undefined;
  const { connectionName }: CellMeta = cell.metadata;

  const variables = nodeKernel.getStoredVariables();
  if (variables._skipSql === true) {
    return {
      stdout,
      stderr: "Skipped.",
    };
  }

  try {
    const obj = JSON.parse(cell.document.getText());
    let updated = 0;
    Object.keys(obj).forEach((key) => {
      nodeKernel.updateVariable(key, obj[key]);
      updated++;
    });

    stdout = `OK: updated ${updated} variable${updated === 1 ? "" : "s"}`;
  } catch (e: any) {
    stderr = e.message;
  }

  return {
    stdout,
    stderr,
  };
};
