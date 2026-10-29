import { randomUUID } from "crypto";
import type { RpcCallKind } from "@l-v-yonsama/multi-platform-database-drivers";
import { NotebookCell, NotebookCellData, NotebookCellKind } from "vscode";
import type { CellMeta } from "../types/Notebook";

export const RPC_CELL_LANGUAGE = "rpc-json";
export const RPC_RESPONSE_MIME = "application/vnd.db-notebook.rpc-response+json";
export const rpcCallKindLabels: Record<RpcCallKind, string> = {
  unary: "unary",
  serverStreaming: "server streaming",
  clientStreaming: "client streaming",
  bidiStreaming: "bidi streaming",
};

export const rpcRequestTemplateBody = (data: string, requestStream: boolean): string =>
  requestStream ? JSON.stringify([JSON.parse(data)], null, 2) : data;

export type RpcCellMeta = CellMeta & {
  rpc: {
    version: 2;
    id: string;
    metadataJson?: string;
    service?: string;
    method?: string;
    path?: string;
    callKind?: RpcCallKind;
  };
};

export const isRpcCellMetadata = (metadata: unknown): metadata is RpcCellMeta => {
  const rpc = (metadata as { rpc?: RpcCellMeta["rpc"] } | undefined)?.rpc;
  return rpc?.version === 2 && typeof rpc.id === "string";
};

export const isRpcCell = (cell: NotebookCell): boolean =>
  cell.kind === NotebookCellKind.Code && cell.document.languageId === RPC_CELL_LANGUAGE;

/** A language switch is enough to identify an RPC cell; settings are saved only when edited. */
export const getRpcCellMetadata = (cell: NotebookCell): RpcCellMeta => {
  const metadata = (cell.metadata ?? {}) as Partial<RpcCellMeta>;
  return {
    ...metadata,
    rpc: {
      version: 2,
      id: metadata.rpc?.id ?? cell.document.uri.toString(),
      metadataJson: metadata.rpc?.metadataJson ?? "{}",
      service: metadata.rpc?.service,
      method: metadata.rpc?.method,
      path: metadata.rpc?.path,
      callKind: metadata.rpc?.callKind,
    },
  };
};

export const makeRpcCellData = (
  options: {
    connectionName?: string;
    service?: string;
    method?: string;
    path?: string;
    callKind?: RpcCallKind;
    dataJson?: string;
    metadataJson?: string;
  } = {}
): NotebookCellData => {
  const cell = new NotebookCellData(
    NotebookCellKind.Code,
    options.dataJson ?? "{}",
    RPC_CELL_LANGUAGE
  );
  const metadata: RpcCellMeta = {
    connectionName: options.connectionName,
    rpc: {
      version: 2,
      id: randomUUID(),
      metadataJson: options.metadataJson ?? "{}",
      service: options.service,
      method: options.method,
      path: options.path,
      callKind: options.callKind,
    },
  };
  cell.metadata = metadata;
  return cell;
};
