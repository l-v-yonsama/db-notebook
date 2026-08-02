import { abbr } from "@l-v-yonsama/rdh";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  MarkdownString,
  NotebookDocument,
  NotebookEdit,
  NotebookRange,
  PreparedToolInvocation,
  Range,
  TextEdit,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { NOTEBOOK_TYPE } from "../../constant";
import { trackInvocation } from "../../treeData/toolActivity/ToolInvocationTracker";
import { CellMeta } from "../../types/Notebook";
import { getErrorMessage } from "../../utilities/errorUtil";
import { log } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";
import { CellInput, CellMetadataInput, buildNotebookCells } from "./notebookCellBuilder";
import { resolveNotebookDocument, resolveNotebookTargetUri } from "./notebookResolver";

const PREFIX = "[lmTools/EditNotebookTool]";
const PREVIEW_MAX_LENGTH = 200;

const OPERATION_KINDS = [
  "insertCells",
  "replaceCells",
  "deleteCells",
  "updateCellMetadata",
  "updateCellSource",
] as const;

export type CellRange = { start: number; end: number };

export type EditOperation =
  | { insertCells: { index: number; cells: CellInput[] } }
  | { replaceCells: { range: CellRange; cells: CellInput[] } }
  | { deleteCells: { range: CellRange } }
  | { updateCellMetadata: { cellIndex: number; metadata: CellMetadataInput } }
  | { updateCellSource: { cellIndex: number; source: string } };

export type EditNotebookToolInput = {
  notebookPath: string;
  operations: EditOperation[];
};

export class EditNotebookTool implements LanguageModelTool<EditNotebookToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<EditNotebookToolInput>,
    _token: CancellationToken
  ): Promise<PreparedToolInvocation | undefined> {
    const { notebookPath, operations } = options.input;
    const invocationMessage = `Editing notebook "${notebookPath}" (${operations?.length ?? 0} operation(s))...`;

    if (!operations?.length) {
      return { invocationMessage };
    }
    const pathResolution = resolveNotebookTargetUri(notebookPath);
    if (!pathResolution.ok) {
      return { invocationMessage };
    }
    const docResolution = await resolveNotebookDocument(pathResolution.uri);
    if (!docResolution.ok) {
      return { invocationMessage };
    }
    const validation = await validateOperations(
      this.stateStorage,
      docResolution.document.cellCount,
      operations
    );
    if (!validation.ok) {
      // invoke() will surface the same error; no need to prompt for a call that can't succeed.
      return { invocationMessage };
    }

    const numbered = operations.map((op, i) => `${i + 1}. ${describeOperation(op)}`).join("\n");
    return {
      invocationMessage,
      confirmationMessages: {
        title: `Apply ${operations.length} edit(s) to "${notebookPath}"?`,
        message: new MarkdownString(
          `This edits your notebook file directly. Review the planned change(s) to **${notebookPath}** below:\n\n${numbered}`
        ),
      },
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<EditNotebookToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { notebookPath, operations } = options.input;
    log(`${PREFIX} invoked notebookPath:[${notebookPath}] operations:[${operations?.length ?? 0}]`);

    return trackInvocation("lmTools", "EditNotebookTool", options.input, async () => {
      try {
        if (!operations?.length) {
          return new LanguageModelToolResult([
            new LanguageModelTextPart("❌ No operations were provided."),
          ]);
        }

        const pathResolution = resolveNotebookTargetUri(notebookPath);
        if (!pathResolution.ok) {
          return new LanguageModelToolResult([new LanguageModelTextPart(`❌ ${pathResolution.message}`)]);
        }

        const docResolution = await resolveNotebookDocument(pathResolution.uri);
        if (!docResolution.ok) {
          const text = `❌ ${docResolution.message} Use createDbNotebook to create it first, or check the path.`;
          log(`${PREFIX} result:[${text}]`);
          return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
        }
        const document = docResolution.document;

        if (document.notebookType !== NOTEBOOK_TYPE) {
          const text = `❌ "${pathResolution.uri.fsPath}" is not a Database Notebook (.dbn) file.`;
          log(`${PREFIX} result:[${text}]`);
          return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
        }

        await window.showNotebookDocument(document);

        const validation = await validateOperations(this.stateStorage, document.cellCount, operations);
        if (!validation.ok) {
          const lines = [`❌ ${validation.message} No changes were made.`];
          if (validation.availableConnectionNames?.length) {
            lines.push(`Available connections: ${validation.availableConnectionNames.join(", ")}`);
          }
          const text = lines.join("\n");
          log(`${PREFIX} result:[${text}]`);
          return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
        }

        const applyResult = await applyOperations(this.stateStorage, document, operations);
        if (!applyResult.ok) {
          const text = `❌ ${applyResult.message}`;
          log(`${PREFIX} result:[${text}]`);
          return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
        }

        const text = [
          `✅ Applied ${operations.length} edit(s) to "${pathResolution.uri.fsPath}".`,
          ...applyResult.details,
        ].join("\n");
        log(`${PREFIX} result:[${text}]`);
        return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
      } catch (e) {
        const text = `❌ Failed to edit notebook "${notebookPath}": ${getErrorMessage(e)}`;
        log(`${PREFIX} result:[${text}]`);
        return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
      }
    });
  }
}

function countPresentKeys(op: EditOperation): number {
  return OPERATION_KINDS.filter((k) => (op as Record<string, unknown>)[k] !== undefined).length;
}

type ValidationResult =
  | { ok: true }
  | { ok: false; message: string; availableConnectionNames?: string[] };

function validateRange(range: CellRange, cellCount: number): string | undefined {
  if (range.start < 0 || range.end < range.start || range.end > cellCount) {
    return `range {start:${range.start}, end:${range.end}} is invalid for a notebook with ${cellCount} cell(s) at this point`;
  }
  return undefined;
}

/**
 * Simulates every operation against a running cell count (no real edits are
 * applied here) so a structurally-invalid batch -- bad index, disallowed
 * connectionName -- is caught with zero mutations, rather than partially
 * applying like a SQL transaction would. Index/range for operation N is
 * evaluated against the count *after* operations 1..N-1 in the same batch.
 */
export async function validateOperations(
  stateStorage: StateStorage,
  initialCellCount: number,
  operations: EditOperation[]
): Promise<ValidationResult> {
  let cellCount = initialCellCount;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const label = `Operation ${i + 1}`;

    if (countPresentKeys(op) !== 1) {
      return {
        ok: false,
        message: `${label}: specify exactly one of ${OPERATION_KINDS.join(", ")}.`,
      };
    }

    if ("insertCells" in op) {
      const { index, cells } = op.insertCells;
      if (index < 0 || index > cellCount) {
        return {
          ok: false,
          message: `${label} (insertCells): index ${index} is out of range for a notebook with ${cellCount} cell(s) at this point.`,
        };
      }
      const built = await buildNotebookCells(stateStorage, cells, undefined);
      if (!built.ok) {
        return {
          ok: false,
          message: `${label} (insertCells): ${built.message}`,
          availableConnectionNames: built.availableConnectionNames,
        };
      }
      cellCount += cells.length;
    } else if ("replaceCells" in op) {
      const { range, cells } = op.replaceCells;
      const rangeError = validateRange(range, cellCount);
      if (rangeError) {
        return { ok: false, message: `${label} (replaceCells): ${rangeError}.` };
      }
      const built = await buildNotebookCells(stateStorage, cells, undefined);
      if (!built.ok) {
        return {
          ok: false,
          message: `${label} (replaceCells): ${built.message}`,
          availableConnectionNames: built.availableConnectionNames,
        };
      }
      cellCount += cells.length - (range.end - range.start);
    } else if ("deleteCells" in op) {
      const { range } = op.deleteCells;
      const rangeError = validateRange(range, cellCount);
      if (rangeError) {
        return { ok: false, message: `${label} (deleteCells): ${rangeError}.` };
      }
      cellCount -= range.end - range.start;
    } else if ("updateCellMetadata" in op) {
      const { cellIndex, metadata } = op.updateCellMetadata;
      if (cellIndex < 0 || cellIndex >= cellCount) {
        return {
          ok: false,
          message: `${label} (updateCellMetadata): cellIndex ${cellIndex} is out of range for a notebook with ${cellCount} cell(s) at this point.`,
        };
      }
      if (metadata?.connectionName) {
        const resolution = await resolveMcpEnabledConnection(stateStorage, metadata.connectionName);
        if (!resolution.ok) {
          return {
            ok: false,
            message: `${label} (updateCellMetadata): ${resolution.message}`,
            availableConnectionNames: resolution.availableConnectionNames,
          };
        }
      }
    } else if ("updateCellSource" in op) {
      const { cellIndex } = op.updateCellSource;
      if (cellIndex < 0 || cellIndex >= cellCount) {
        return {
          ok: false,
          message: `${label} (updateCellSource): cellIndex ${cellIndex} is out of range for a notebook with ${cellCount} cell(s) at this point.`,
        };
      }
    }
  }

  return { ok: true };
}

type ApplyResult =
  | { ok: true; details: string[] }
  | { ok: false; message: string; completed: number };

/**
 * `workspace.applyEdit` resolves to `false` (not a rejected promise) when VS Code
 * declines the edit, e.g. a concurrent change to the notebook. Without this check the
 * caller would treat a no-op as a success.
 */
async function applyOrThrow(edit: WorkspaceEdit): Promise<void> {
  const applied = await workspace.applyEdit(edit);
  if (!applied) {
    throw new Error("workspace.applyEdit was rejected (edit not applied)");
  }
}

export async function applyOperations(
  stateStorage: StateStorage,
  document: NotebookDocument,
  operations: EditOperation[]
): Promise<ApplyResult> {
  const details: string[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    try {
      if ("insertCells" in op) {
        const { index, cells } = op.insertCells;
        const built = await buildNotebookCells(stateStorage, cells, undefined);
        if (!built.ok) {
          throw new Error(built.message);
        }
        const edit = new WorkspaceEdit();
        edit.set(document.uri, [NotebookEdit.insertCells(index, built.cells)]);
        await applyOrThrow(edit);
        details.push(`${i + 1}. insertCells: ${cells.length} cell(s) at index ${index}`);
      } else if ("replaceCells" in op) {
        const { range, cells } = op.replaceCells;
        const built = await buildNotebookCells(stateStorage, cells, undefined);
        if (!built.ok) {
          throw new Error(built.message);
        }
        const edit = new WorkspaceEdit();
        edit.set(document.uri, [
          NotebookEdit.replaceCells(new NotebookRange(range.start, range.end), built.cells),
        ]);
        await applyOrThrow(edit);
        details.push(`${i + 1}. replaceCells: cells ${range.start}-${range.end} with ${cells.length} cell(s)`);
      } else if ("deleteCells" in op) {
        const { range } = op.deleteCells;
        const edit = new WorkspaceEdit();
        edit.set(document.uri, [NotebookEdit.deleteCells(new NotebookRange(range.start, range.end))]);
        await applyOrThrow(edit);
        details.push(`${i + 1}. deleteCells: cells ${range.start}-${range.end}`);
      } else if ("updateCellMetadata" in op) {
        const { cellIndex, metadata } = op.updateCellMetadata;
        const cell = document.cellAt(cellIndex);
        const merged: CellMeta = { ...(cell.metadata as CellMeta), ...metadata };
        const edit = new WorkspaceEdit();
        edit.set(document.uri, [NotebookEdit.updateCellMetadata(cellIndex, merged)]);
        await applyOrThrow(edit);
        details.push(`${i + 1}. updateCellMetadata: cell ${cellIndex}`);
      } else if ("updateCellSource" in op) {
        const { cellIndex, source } = op.updateCellSource;
        const cell = document.cellAt(cellIndex);
        const doc = cell.document;
        const range = new Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        const edit = new WorkspaceEdit();
        edit.set(doc.uri, [new TextEdit(range, source)]);
        await applyOrThrow(edit);
        details.push(`${i + 1}. updateCellSource: cell ${cellIndex}`);
      }
    } catch (e) {
      return {
        ok: false,
        message: `Operation ${i + 1}/${operations.length} ("${OPERATION_KINDS.find((k) => k in op)}") failed: ${getErrorMessage(
          e
        )}. ${i} of ${operations.length} operation(s) were already applied before the failure -- check the notebook before continuing.`,
        completed: i,
      };
    }
  }

  return { ok: true, details };
}

function describeCellPreview(cell: CellInput): string {
  const lang = cell.kind === "markup" ? "markdown" : cell.language ?? "?";
  return `[${lang}] "${abbr(cell.value, PREVIEW_MAX_LENGTH)}"`;
}

function describeOperation(op: EditOperation): string {
  if ("insertCells" in op) {
    const { index, cells } = op.insertCells;
    return `**Insert** ${cells.length} cell(s) at index ${index}: ${cells.map(describeCellPreview).join(", ")}`;
  }
  if ("replaceCells" in op) {
    const { range, cells } = op.replaceCells;
    return `**Replace** cells ${range.start}-${range.end} with ${cells.length} cell(s): ${cells
      .map(describeCellPreview)
      .join(", ")}`;
  }
  if ("deleteCells" in op) {
    const { range } = op.deleteCells;
    return `**Delete** cells ${range.start}-${range.end}`;
  }
  if ("updateCellMetadata" in op) {
    const { cellIndex, metadata } = op.updateCellMetadata;
    const fields = Object.entries(metadata ?? {})
      .map(([k, v]) => `${k} → ${JSON.stringify(v)}`)
      .join(", ");
    return `**Update metadata** of cell ${cellIndex}: ${fields || "(no fields)"}`;
  }
  if ("updateCellSource" in op) {
    const { cellIndex, source } = op.updateCellSource;
    return `**Replace source** of cell ${cellIndex} with:\n\`\`\`\n${abbr(source, PREVIEW_MAX_LENGTH)}\n\`\`\``;
  }
  return "Unknown operation";
}
