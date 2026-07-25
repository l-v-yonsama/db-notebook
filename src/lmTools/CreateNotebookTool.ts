import { separateMultipleQueries } from "@l-v-yonsama/multi-platform-database-drivers";
import * as path from "path";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  NotebookCellKind,
  NotebookData,
  Uri,
  window,
  workspace,
} from "vscode";
import { DBNotebookSerializer } from "../notebook/serializer";
import { createDirectory, existsUri, writeBytesToResource } from "../utilities/fsUtil";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { CellInput, buildNotebookCells } from "./notebookCellBuilder";
import { findOpenNotebookDocument, resolveNotebookTargetUri } from "./notebookResolver";

const PREFIX = "[lmTools/CreateNotebookTool]";

export type CreateNotebookToolInput = {
  notebookPath: string;
  connectionName?: string;
  sqlText?: string;
  cells?: CellInput[];
};

export class CreateNotebookTool implements LanguageModelTool<CreateNotebookToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async invoke(
    options: LanguageModelToolInvocationOptions<CreateNotebookToolInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { notebookPath, connectionName, sqlText, cells } = options.input;
    log(
      `${PREFIX} invoked notebookPath:[${notebookPath}] connectionName:[${
        connectionName ?? ""
      }] cells:[${cells?.length ?? 0}] sqlText:[${sqlText ? "yes" : "no"}]`
    );

    try {
      const result = await createNotebook(this.stateStorage, options.input, token);
      const lines = [result.ok ? `✅ ${result.message}` : `❌ ${result.message}`];
      if (!result.ok && result.availableConnectionNames?.length) {
        lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
      }
      const text = lines.join("\n");
      log(`${PREFIX} result:[${text}]`);
      return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
    } catch (e: any) {
      const text = `❌ Failed to create notebook "${notebookPath}": ${e?.message ?? e}`;
      log(`${PREFIX} result:[${text}]`);
      return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
    }
  }
}

type CreateNotebookResult =
  | { ok: true; message: string }
  | { ok: false; message: string; availableConnectionNames?: string[] };

async function createNotebook(
  stateStorage: StateStorage,
  input: CreateNotebookToolInput,
  token: CancellationToken
): Promise<CreateNotebookResult> {
  const { notebookPath, connectionName, sqlText, cells } = input;

  if (!cells?.length && !sqlText) {
    return { ok: false, message: "Provide exactly one of cells or sqlText." };
  }
  if (cells?.length && sqlText) {
    return { ok: false, message: "Provide exactly one of cells or sqlText, not both." };
  }

  let cellInputs: CellInput[];
  if (sqlText) {
    const queries = separateMultipleQueries(sqlText);
    if (queries.length === 0) {
      return { ok: false, message: "No SQL statements were found in sqlText." };
    }
    cellInputs = queries.map((sql) => ({ kind: "code", language: "sql", value: sql }));
  } else {
    cellInputs = cells!;
  }

  const pathResolution = resolveNotebookTargetUri(notebookPath);
  if (!pathResolution.ok) {
    return { ok: false, message: pathResolution.message };
  }
  const { uri } = pathResolution;

  if (await existsUri(uri)) {
    return {
      ok: false,
      message: `A file already exists at "${uri.fsPath}". Use editDbNotebook to modify it, or choose a different notebookPath.`,
    };
  }
  if (findOpenNotebookDocument(uri)) {
    return {
      ok: false,
      message: `A notebook is already open at "${uri.fsPath}". Close it, or use editDbNotebook instead.`,
    };
  }

  const buildResult = await buildNotebookCells(stateStorage, cellInputs, connectionName);
  if (!buildResult.ok) {
    return {
      ok: false,
      message: buildResult.message,
      availableConnectionNames: buildResult.availableConnectionNames,
    };
  }

  await createDirectory(Uri.file(path.dirname(uri.fsPath)));

  const notebookData = new NotebookData(buildResult.cells);
  const bytes = await new DBNotebookSerializer().serializeNotebook(notebookData, token);
  await writeBytesToResource(uri, bytes);

  const document = await workspace.openNotebookDocument(uri);
  await window.showNotebookDocument(document);

  const cellSummary = buildResult.cells
    .map((c) => (c.kind === NotebookCellKind.Markup ? "markdown" : c.languageId))
    .join(", ");
  return {
    ok: true,
    message: `Created "${uri.fsPath}" with ${buildResult.cells.length} cell(s) (${cellSummary}).`,
  };
}
