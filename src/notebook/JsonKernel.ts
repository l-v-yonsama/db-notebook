import { CellMeta, RunResult } from "../types/Notebook";
import { NotebookCell } from "vscode";
import { log } from "../utilities/logger";
import { NodeKernel } from "./NodeKernel";

const PREFIX = "  [notebook/JsonKernel]";

export const jsonKernelRun = async (
  cell: NotebookCell,
  nodeKernel: NodeKernel
): Promise<RunResult> => {
  let stdout = "";
  let stderr = "";

  const variables = nodeKernel.getStoredVariables();
  if (variables._skipSql === true) {
    return {
      stdout,
      stderr,
      skipped: true,
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
  } catch (e) {
    if (e instanceof Error) {
      stderr = e.message;
    } else {
      stderr = "Error:" + e;
    }
  }

  return {
    stdout,
    stderr,
    skipped: false,
  };
};
