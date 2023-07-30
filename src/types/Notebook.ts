import { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCellKind } from "vscode";

export type CellMeta = {
  connectionName?: string;
  ruleFile?: string;
  codeResolverFile?: string;
  showComment?: boolean;
  markAsSkip?: boolean;
  readonly [key: string]: any;
};

export type NotebookMeta = {
  readonly [key: string]: any;
};

export type RawNotebookData = {
  cells: RawNotebookCell[];
  metadata?: NotebookMeta;
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
  skipped: boolean;
  metadata?: {
    rdh?: ResultSetData;
    [key: string]: any;
  };
};
