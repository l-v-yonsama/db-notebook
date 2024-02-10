import type { NotebookCellKind } from "vscode";
import type { RunResultMetadata } from "../shared/RunResultMetadata";

export type SQLMode = "Query" | "Explain" | "ExplainAnalyze";

export type CellMeta = {
  markAsSkip?: boolean;
  markAsRunInOrderAtJsonCell?: boolean;
  connectionName?: string;
  showComment?: boolean;
  ruleFile?: string;
  codeResolverFile?: string;
  sharedVariableName?: string;
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
  metadata?: RunResultMetadata;
};
