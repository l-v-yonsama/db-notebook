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

export class Uri {
  private constructor(public readonly fsPath: string) {}

  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri([base.fsPath, ...segments].join("/").replace(/\/+/g, "/"));
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
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
  showNotebookDocument: vi.fn(async (_document: unknown) => undefined),
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
  workspaceFolders: undefined as { uri: Uri; name?: string; index?: number }[] | undefined,
  notebookDocuments: [] as unknown[],
  openNotebookDocument: vi.fn(async (_uri: Uri) => {
    throw new Error("workspace.openNotebookDocument is not mocked in this test");
  }),
  fs: {
    stat: vi.fn(async (_uri: Uri) => {
      throw new Error("workspace.fs.stat is not mocked in this test");
    }),
    writeFile: vi.fn(async (_uri: Uri, _content: Uint8Array) => undefined),
    readFile: vi.fn(async (_uri: Uri) => new Uint8Array()),
    createDirectory: vi.fn(async (_uri: Uri) => undefined),
    delete: vi.fn(
      async (_uri: Uri, _options?: { recursive?: boolean; useTrash?: boolean }) => undefined
    ),
  },
};

export class Range {
  constructor(public start: unknown, public end: unknown) {}
}

export class NotebookRange {
  constructor(public start: number, public end: number) {}
}

export class NotebookCellData {
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  constructor(public kind: NotebookCellKind, public value: string, public languageId: string) {}
}

export class NotebookData {
  metadata?: Record<string, unknown>;
  constructor(public cells: NotebookCellData[]) {}
}

export class MarkdownString {
  constructor(public value: string = "") {}
}

export class LanguageModelTextPart {
  constructor(public value: string) {}
}

export class LanguageModelToolResult {
  constructor(public content: unknown[]) {}
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
  static insertCells(index: number, newCells: unknown[]) {
    return { index, newCells };
  }
  static replaceCells(range: unknown, newCells: unknown[]) {
    return { range, newCells };
  }
  static deleteCells(range: unknown) {
    return { range };
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
  replaceOutput: vi.fn(async function (
    this: { outputs: NotebookCellOutput[] },
    outputs: NotebookCellOutput[]
  ) {
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
