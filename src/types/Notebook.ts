import { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCellKind } from "vscode";

export type CellMeta = {
  connectionName?: string;
  readonly [key: string]: any;
};

export type RawNotebookData = {
  cells: RawNotebookCell[];
};

export type RawNotebookCell = {
  language: string;
  value: string;
  kind: NotebookCellKind;
  editable?: boolean;
  metadata?: CellMeta;
};

export type NotebookExecutionVariables = {
  _skipSql?: boolean;
  [key: string]: any;
};

export type RunResult = {
  stdout: string;
  stderr: string;
  metadata?: {
    rdh?: ResultSetData;
    [key: string]: any;
  };
};
