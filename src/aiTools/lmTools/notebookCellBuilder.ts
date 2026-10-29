import { NotebookCellData, NotebookCellKind } from "vscode";
import {
  getRpcCallKind,
  parseRpcRequestMetadata,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta } from "../../types/Notebook";
import { StateStorage } from "../../utilities/StateStorage";
import { makeRpcCellData, RPC_CELL_LANGUAGE } from "../../notebook/rpcCell";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";
import { resolveRpcMethod } from "./rpcMethodResolver";

const CODE_LANGUAGES = [
  "sql",
  "javascript",
  "typescript",
  "json",
  RPC_CELL_LANGUAGE,
  "cwql",
  "memcached",
  "redis",
  "plaintext",
  "shellscript",
  "bat",
] as const;
type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const CONNECTION_REQUIRED_LANGUAGES: ReadonlySet<string> = new Set([
  "sql",
  "cwql",
  "memcached",
  "redis",
  RPC_CELL_LANGUAGE,
]);

export type CellMetadataInput = {
  connectionName?: string;
  useDatabaseName?: string;
  markAsSkip?: boolean;
  logGroupName?: string;
  logGroupStartTimeOffset?: "1m" | "5m" | "15m" | "30m" | "1h" | "6h" | "12h" | "1d" | "1w";
  sharedVariableName?: string;
  publishParams?: { topicName: string; qos: 0 | 1 | 2; retain: boolean };
  rpc?: { service: string; method: string; metadata?: Record<string, string | string[]> };
};

export type CellInput = {
  kind: "code" | "markup";
  language?: string;
  value: string;
  metadata?: CellMetadataInput;
};

export type BuildCellsResult =
  | { ok: true; cells: NotebookCellData[] }
  | { ok: false; message: string; availableConnectionNames?: string[] };

// A json/plaintext code cell becomes an MQTT publish cell purely by having
// publishParams set (see isMqttCell in notebookUtil.ts) -- there's no
// separate "mqtt" language, so connection-requiredness has to be derived.
function cellNeedsConnection(input: CellInput): boolean {
  if (input.kind !== "code") {
    return false;
  }
  if (input.language && CONNECTION_REQUIRED_LANGUAGES.has(input.language)) {
    return true;
  }
  return (
    (input.language === "json" || input.language === "plaintext") && !!input.metadata?.publishParams
  );
}

/**
 * Validates model-supplied cell definitions and builds NotebookCellData[].
 * Fails the whole array on the first problem (no partial cell lists), and
 * resolves every referenced connectionName through the same mcpEnabled gate
 * every other lmTool uses -- this tool never runs a query itself, but a cell
 * it authors will run the moment a human trusts the notebook and hits Run.
 *
 * CellMetadataInput deliberately exposes a curated subset of CellMeta (see
 * src/types/Notebook.ts): fields like `chart` (needs result columns that
 * don't exist yet) and `codeResolverFile` (a separate file schema)
 * aren't things a model authoring a cell up front can fill in correctly.
 */
export async function buildNotebookCells(
  stateStorage: StateStorage,
  cells: CellInput[],
  defaultConnectionName: string | undefined
): Promise<BuildCellsResult> {
  if (!cells || cells.length === 0) {
    return { ok: false, message: "cells must contain at least one cell." };
  }

  const connectionNamesToCheck = new Set<string>();

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const label = `Cell ${i + 1}`;

    if (cell.kind !== "code" && cell.kind !== "markup") {
      return { ok: false, message: `${label}: kind must be "code" or "markup".` };
    }
    if (typeof cell.value !== "string") {
      return { ok: false, message: `${label}: value must be a string.` };
    }
    if (cell.kind === "code") {
      if (!cell.language || !CODE_LANGUAGES.includes(cell.language as CodeLanguage)) {
        return {
          ok: false,
          message: `${label}: language must be one of ${CODE_LANGUAGES.join(
            ", "
          )} for a code cell.`,
        };
      }
      if (cell.language === "cwql" && !cell.metadata?.logGroupName) {
        return { ok: false, message: `${label}: cwql cells require metadata.logGroupName.` };
      }
      if (
        cell.language === RPC_CELL_LANGUAGE &&
        (!cell.metadata?.rpc?.service || !cell.metadata.rpc.method)
      ) {
        return {
          ok: false,
          message: `${label}: rpc-json cells require metadata.rpc.service and metadata.rpc.method.`,
        };
      }
      if (cell.language !== RPC_CELL_LANGUAGE && cell.metadata?.rpc) {
        return { ok: false, message: `${label}: metadata.rpc is only valid for rpc-json cells.` };
      }
    }

    if (cellNeedsConnection(cell)) {
      const name = cell.metadata?.connectionName ?? defaultConnectionName;
      if (!name) {
        return {
          ok: false,
          message: `${label}: this cell needs a connectionName (set metadata.connectionName on the cell, or pass a top-level default connectionName).`,
        };
      }
      connectionNamesToCheck.add(name);
    } else if (cell.metadata?.connectionName) {
      connectionNamesToCheck.add(cell.metadata.connectionName);
    }
  }

  for (const name of connectionNamesToCheck) {
    const resolution = await resolveMcpEnabledConnection(stateStorage, name);
    if (!resolution.ok) {
      return {
        ok: false,
        message: resolution.message,
        availableConnectionNames: resolution.availableConnectionNames,
      };
    }
  }

  const built: NotebookCellData[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.kind === "markup") {
      built.push(new NotebookCellData(NotebookCellKind.Markup, cell.value, "markdown"));
      continue;
    }

    if (cell.language === RPC_CELL_LANGUAGE) {
      try {
        const name = cell.metadata?.connectionName ?? defaultConnectionName!;
        const rpc = cell.metadata!.rpc!;
        const { service, method } = await resolveRpcMethod(
          stateStorage,
          name,
          rpc.service,
          rpc.method
        );
        const value: unknown = JSON.parse(cell.value);
        const isObject = (item: unknown): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item);
        if (
          method.requestStream ? !Array.isArray(value) || !value.every(isObject) : !isObject(value)
        ) {
          return {
            ok: false,
            message: `Cell ${i + 1}: ${
              method.requestStream
                ? "client/bidi streaming requires a JSON array of request objects"
                : "unary/server streaming requires a JSON request object"
            }.`,
          };
        }
        const metadata = parseRpcRequestMetadata(rpc.metadata);
        const data = makeRpcCellData({
          connectionName: name,
          service: service.fullName,
          method: method.name,
          path: method.path,
          callKind: getRpcCallKind(method),
          dataJson: cell.value,
          metadataJson: JSON.stringify(metadata),
        });
        if (cell.metadata?.markAsSkip !== undefined) {
          data.metadata = { ...data.metadata, markAsSkip: cell.metadata.markAsSkip };
        }
        built.push(data);
      } catch (error) {
        return {
          ok: false,
          message: `Cell ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      continue;
    }

    const data = new NotebookCellData(NotebookCellKind.Code, cell.value, cell.language!);
    const metadata: CellMeta = { ...(cell.metadata ?? {}) };
    if (cellNeedsConnection(cell) && !metadata.connectionName) {
      metadata.connectionName = defaultConnectionName;
    }
    if (Object.keys(metadata).length > 0) {
      data.metadata = metadata;
    }
    built.push(data);
  }

  return { ok: true, cells: built };
}
