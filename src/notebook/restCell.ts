import { NotebookCell, NotebookCellKind } from "vscode";
import type { CellMeta } from "../types/Notebook";

export const REST_CELL_LANGUAGE = "rest-json";
export const REST_RESPONSE_MIME = "application/vnd.db-notebook.rest-response+json";
export const REST_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type RestMethod = (typeof REST_METHODS)[number];

export type RestCellMeta = CellMeta & {
  rest?: {
    version: 1;
    id?: string;
    method?: RestMethod;
    url?: string;
    headersJson?: string;
    timeoutMs?: number;
  };
};

export const isRestCell = (cell: NotebookCell): boolean =>
  cell.kind === NotebookCellKind.Code && cell.document.languageId === REST_CELL_LANGUAGE;

export const getRestCellMetadata = (cell: NotebookCell): RestCellMeta => {
  const metadata = (cell.metadata ?? {}) as RestCellMeta;
  return {
    ...metadata,
    rest: {
      version: 1,
      id: metadata.rest?.id ?? cell.document.uri.toString(),
      method: metadata.rest?.method ?? "GET",
      url: metadata.rest?.url ?? "",
      headersJson: metadata.rest?.headersJson ?? "{}",
      timeoutMs: metadata.rest?.timeoutMs ?? 30000,
    },
  };
};
