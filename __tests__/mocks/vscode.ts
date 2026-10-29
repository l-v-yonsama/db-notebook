// Minimal stand-in for the "vscode" module, which only exists inside the
// real VS Code extension host at runtime. Enum values are copied from
// node_modules/@types/vscode so behavior matches the real API.
import { vi } from "vitest";

export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export enum ViewColumn {
  One = 1,
  Two = 2,
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  description?: string;
  iconPath?: unknown;
  contextValue?: string;
  tooltip?: unknown;
  command?: unknown;
  constructor(public label: string, public collapsibleState?: TreeItemCollapsibleState) {}
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(data: T): void {
    this.listeners.forEach((listener) => listener(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  private constructor(public readonly fsPath: string) {}

  get scheme(): string { return "file"; }
  get path(): string { return this.fsPath; }
  get authority(): string { return ""; }

  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(require("node:path").posix.normalize([base.fsPath, ...segments].join("/")));
  }

  static parse(value: string): Uri {
    return new Uri(value);
  }

  static from(parts: { scheme: string; path: string }): Uri {
    return new Uri(`${parts.scheme}:${parts.path}`);
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export class RelativePattern {
  constructor(public readonly base: unknown, public readonly pattern: string) {}
}

export const window = {
  withProgress: vi.fn(
    async (
      _options: unknown,
      task: (
        progress: { report: (value: unknown) => void },
        token: {
          isCancellationRequested: boolean;
          onCancellationRequested: (listener: () => void) => { dispose: () => void };
        }
      ) => Promise<unknown>
    ) =>
      task(
        { report: () => {} },
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => {} }),
        }
      )
  ),
  visibleNotebookEditors: [] as unknown[],
  activeNotebookEditor: undefined as unknown,
  activeTextEditor: undefined as unknown,
  onDidChangeActiveNotebookEditor: vi.fn((_listener: (e: unknown) => void) => ({
    dispose: () => {},
  })),
  setStatusBarMessage: vi.fn((..._args: unknown[]) => ({ dispose: () => {} })),
  createTextEditorDecorationType: vi.fn((_options: unknown) => ({ dispose: () => {} })),
  showNotebookDocument: vi.fn(async (_document: unknown) => undefined),
  showTextDocument: vi.fn(async (_document: unknown) => undefined),
  showInformationMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
  showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
  showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
  showQuickPick: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  showOpenDialog: vi.fn(async (..._args: unknown[]) => undefined as Uri[] | undefined),
  showSaveDialog: vi.fn(async (..._args: unknown[]) => undefined as Uri | undefined),
  createWebviewPanel: vi.fn((..._args: unknown[]) => ({
    webview: {
      html: "",
      cspSource: "vscode-webview:",
      asWebviewUri: vi.fn((uri: Uri) => uri),
      postMessage: vi.fn(async (..._message: unknown[]) => true),
      onDidReceiveMessage: vi.fn((_listener: (message: unknown) => void) => ({ dispose: () => {} })),
    },
    onDidDispose: vi.fn((_listener: () => void) => ({ dispose: () => {} })),
    reveal: vi.fn(),
    dispose: vi.fn(),
  })),
};

export const commands = {
  executeCommand: vi.fn(async (..._args: unknown[]) => undefined),
  registerCommand: vi.fn((_command: string, _callback: (...args: unknown[]) => unknown) => ({
    dispose: () => {},
  })),
};

export const authentication = {
  getSession: vi.fn(async (..._args: unknown[]) => undefined),
};

export const env = {
  clipboard: {
    writeText: vi.fn(async (_text: string) => undefined),
  },
  openExternal: vi.fn(async (_uri: Uri) => true),
};

export const workspace = {
  onDidChangeTextDocument: vi.fn((_listener: (e: unknown) => void) => ({
    dispose: () => {},
  })),
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
  getWorkspaceFolder: vi.fn((_uri: Uri) => undefined as { uri: Uri; name: string } | undefined),
  findFiles: vi.fn(async (..._args: unknown[]) => [] as Uri[]),
  notebookDocuments: [] as unknown[],
  openNotebookDocument: vi.fn(async (_uri: Uri) => {
    throw new Error("workspace.openNotebookDocument is not mocked in this test");
  }),
  openTextDocument: vi.fn(async (_uri: Uri) => ({ uri: _uri })),
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

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendText(value: string): MarkdownString {
    this.value += value.replace(/[\\`*_{}\[\]()#+.!|>\-]/g, "\\$&");
    return this;
  }

  appendCodeblock(value: string, language = ""): MarkdownString {
    this.value += `\n\n\`\`\`${language}\n${value}\n\`\`\``;
    return this;
  }
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
  replace(uri: { toString(): string }, range: unknown, newText: string) {
    this.edits.set(uri.toString(), [{ range, newText }]);
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

  static json(value: unknown, mime = "application/json") {
    return new NotebookCellOutputItem(mime, value);
  }

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
  createRendererMessaging: vi.fn((_id: string) => ({
    onDidReceiveMessage: vi.fn((_listener: (e: unknown) => void) => ({ dispose: () => {} })),
    postMessage: vi.fn(async (_message: unknown, _editor?: unknown) => false),
  })),
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
