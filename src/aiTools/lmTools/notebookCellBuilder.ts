import { NotebookCellData, NotebookCellKind } from "vscode";
import { CellMeta } from "../../types/Notebook";
import { StateStorage } from "../../utilities/StateStorage";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";

const CODE_LANGUAGES = ["sql", "javascript", "json", "cwql", "memcached", "plaintext"] as const;
type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const CONNECTION_REQUIRED_LANGUAGES: ReadonlySet<string> = new Set(["sql", "cwql", "memcached"]);

export type CellMetadataInput = {
  connectionName?: string;
  useDatabaseName?: string;
  markAsSkip?: boolean;
  logGroupName?: string;
  logGroupStartTimeOffset?: "1m" | "5m" | "15m" | "30m" | "1h" | "6h" | "12h" | "1d" | "1w";
  sharedVariableName?: string;
  publishParams?: { topicName: string; qos: 0 | 1 | 2; retain: boolean };
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
  return (input.language === "json" || input.language === "plaintext") && !!input.metadata?.publishParams;
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
 * don't exist yet), `ruleFile`/`codeResolverFile` (separate file schemas),
 * and `lmPromptCreateConditions` (a different AI feature's own settings)
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
          message: `${label}: language must be one of ${CODE_LANGUAGES.join(", ")} for a code cell.`,
        };
      }
      if (cell.language === "cwql" && !cell.metadata?.logGroupName) {
        return { ok: false, message: `${label}: cwql cells require metadata.logGroupName.` };
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

  const built = cells.map((cell) => {
    if (cell.kind === "markup") {
      return new NotebookCellData(NotebookCellKind.Markup, cell.value, "markdown");
    }

    const data = new NotebookCellData(NotebookCellKind.Code, cell.value, cell.language!);
    const metadata: CellMeta = { ...(cell.metadata ?? {}) };
    if (cellNeedsConnection(cell) && !metadata.connectionName) {
      metadata.connectionName = defaultConnectionName;
    }
    if (Object.keys(metadata).length > 0) {
      data.metadata = metadata;
    }
    return data;
  });

  return { ok: true, cells: built };
}
