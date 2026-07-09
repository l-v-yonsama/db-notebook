// Minimal stand-in for the "vscode" module, which only exists inside the
// real VS Code extension host at runtime. Enum values are copied from
// node_modules/@types/vscode so behavior matches the real API.
export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export const window = {
  visibleNotebookEditors: [] as unknown[],
  activeNotebookEditor: undefined as unknown,
};
