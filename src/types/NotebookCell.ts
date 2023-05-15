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
