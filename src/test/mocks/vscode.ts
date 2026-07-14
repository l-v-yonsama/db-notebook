// Minimal stand-in for the "vscode" module, which only exists inside the
// real VS Code extension host at runtime. Enum values are copied from
// node_modules/@types/vscode so behavior matches the real API.
import { vi } from "vitest";

export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export class ThemeColor {
  constructor(public id: string) {}
}

export const window = {
  visibleNotebookEditors: [] as unknown[],
  activeNotebookEditor: undefined as unknown,
  activeTextEditor: undefined as unknown,
  onDidChangeActiveNotebookEditor: vi.fn((_listener: (e: unknown) => void) => ({
    dispose: () => {},
  })),
  setStatusBarMessage: vi.fn((..._args: unknown[]) => ({ dispose: () => {} })),
  createTextEditorDecorationType: vi.fn((_options: unknown) => ({ dispose: () => {} })),
};

export const commands = {
  executeCommand: vi.fn(async (..._args: unknown[]) => undefined),
};

export const workspace = {
  onDidCloseNotebookDocument: vi.fn((_listener: (e: unknown) => void) => ({
    dispose: () => {},
  })),
  onDidChangeNotebookDocument: vi.fn((_listener: (e: unknown) => void) => ({
    dispose: () => {},
  })),
  onDidOpenNotebookDocument: vi.fn((_listener: (e: unknown) => void) => ({
    dispose: () => {},
  })),
  applyEdit: vi.fn(async (_edit: unknown) => true),
  getConfiguration: vi.fn((_section?: string) => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
  })),
};

export class Range {
  constructor(public start: unknown, public end: unknown) {}
}

export class TextEdit {
  constructor(public range: Range, public newText: string) {}
}

export class WorkspaceEdit {
  private edits = new Map<string, unknown[]>();
  set(uri: { toString(): string }, edits: unknown[]) {
    this.edits.set(uri.toString(), edits);
  }
  get(uri: { toString(): string }) {
    return this.edits.get(uri.toString()) ?? [];
  }
}

export class NotebookEdit {
  static updateCellMetadata(index: number, metadata: unknown) {
    return { index, metadata };
  }
}

export class CancellationTokenSource {
  token = { isCancellationRequested: false };
  cancel = vi.fn(() => {
    this.token.isCancellationRequested = true;
  });
  dispose = vi.fn();
}

export class NotebookCellOutputItem {
  private constructor(public mime: string, public data: unknown) {}

  static text(value: string, mime = "text/plain") {
    return new NotebookCellOutputItem(mime, value);
  }
  static stdout(value: string) {
    return new NotebookCellOutputItem("application/vnd.code.notebook.stdout", value);
  }
  static stderr(value: string) {
    return new NotebookCellOutputItem("application/vnd.code.notebook.stderr", value);
  }
  static error(err: Error) {
    return new NotebookCellOutputItem("application/vnd.code.notebook.error", {
      name: err.name,
      message: err.message,
    });
  }
}

export class NotebookCellOutput {
  constructor(public items: NotebookCellOutputItem[], public metadata?: unknown) {}
}

const makeNotebookCellExecution = (_cell: unknown) => ({
  executionOrder: 0,
  outputs: [] as NotebookCellOutput[],
  startedAt: undefined as number | undefined,
  endedAt: undefined as { success?: boolean; time: number } | undefined,
  start(time?: number) {
    this.startedAt = time;
  },
  end(success?: boolean, time?: number) {
    this.endedAt = { success, time: time ?? 0 };
  },
  replaceOutput: vi.fn(async function (this: { outputs: NotebookCellOutput[] }, outputs: NotebookCellOutput[]) {
    this.outputs = outputs;
  }),
});

export const notebooks = {
  createNotebookController: vi.fn((_id: string, _type: string, _label: string) => ({
    supportedLanguages: [] as string[],
    supportsExecutionOrder: false,
    executeHandler: undefined as unknown,
    interruptHandler: undefined as unknown,
    createNotebookCellExecution: vi.fn(makeNotebookCellExecution),
    dispose: vi.fn(),
  })),
  registerNotebookCellStatusBarItemProvider: vi.fn((_type: string, _provider: unknown) => ({
    dispose: () => {},
  })),
};
