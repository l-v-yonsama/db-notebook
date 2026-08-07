import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { commands, NotebookCellKind, Uri, window, workspace } from "vscode";
import {
  CFN_DIAGRAM_PREVIEW_DRAWIO_FILE_NAME,
  CFN_DIAGRAM_PREVIEW_FILE_NAME,
  upsertCfnDiagramPreviewDrawio,
  upsertCfnDiagramPreviewNotebook,
} from "../../src/utilities/cfnDiagramPreviewNotebook";

// Same cast-through-unknown workaround as fsUtil.test.ts - workspaceFolders is typed
// readonly on the real vscode.d.ts this import resolves to for type-checking.
type MockWorkspaceFolders = { uri: Uri; name?: string; index?: number }[] | undefined;
const setWorkspaceFolders = (folders: MockWorkspaceFolders): void => {
  (workspace as unknown as { workspaceFolders: MockWorkspaceFolders }).workspaceFolders = folders;
};

const decode = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8");
const writtenNotebook = (): any => {
  const [, bytes] = (workspace.fs.writeFile as Mock).mock.calls[0];
  return JSON.parse(decode(bytes));
};

beforeEach(() => {
  vi.clearAllMocks();
  setWorkspaceFolders([{ uri: Uri.file("/workspace") }]);
  (workspace.openNotebookDocument as Mock).mockResolvedValue({
    uri: Uri.file(`/workspace/${CFN_DIAGRAM_PREVIEW_FILE_NAME}`),
  });
});

describe("upsertCfnDiagramPreviewNotebook", () => {
  it("shows an error and writes nothing when no workspace folder is open", async () => {
    setWorkspaceFolders(undefined);

    await upsertCfnDiagramPreviewNotebook("# hello");

    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it("creates a new notebook with one markdown cell when the file doesn't exist yet", async () => {
    (workspace.fs.readFile as Mock).mockRejectedValue(new Error("ENOENT"));

    await upsertCfnDiagramPreviewNotebook("# hello");

    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    const [uri] = (workspace.fs.writeFile as Mock).mock.calls[0];
    expect((uri as Uri).fsPath).toBe(`/workspace/${CFN_DIAGRAM_PREVIEW_FILE_NAME}`);

    const written = writtenNotebook();
    expect(written.cells).toHaveLength(1);
    expect(written.cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(written.cells[0].language).toBe("markdown");
    expect(written.cells[0].value).toBe("# hello");
    expect(window.showNotebookDocument).toHaveBeenCalledWith(
      expect.anything(),
      { viewColumn: 2 }
    );
  });

  it("adds one Markdown source cell per CloudFormation template", async () => {
    (workspace.fs.readFile as Mock).mockRejectedValue(new Error("ENOENT"));

    await upsertCfnDiagramPreviewNotebook("# diagram", [
      { stackName: "stack-a", source: "Resources:\n  Api:\n    Type: AWS::ApiGateway::RestApi" },
    ]);

    const written = writtenNotebook();
    expect(written.cells).toHaveLength(2);
    expect(written.cells[0].value).toBe("# diagram");
    expect(written.cells[1].language).toBe("markdown");
    expect(written.cells[1].value).toContain("## CloudFormation template: stack-a");
    expect(written.cells[1].value).toContain("```yaml");
  });

  it("replaces cell 0's content in place when it's already a markdown cell, leaving later cells untouched", async () => {
    const existing = {
      cells: [
        { kind: NotebookCellKind.Markup, language: "markdown", value: "# old diagram" },
        { kind: NotebookCellKind.Code, language: "sql", value: "select 1" },
      ],
      metadata: {},
    };
    (workspace.fs.readFile as Mock).mockResolvedValue(
      Buffer.from(JSON.stringify(existing), "utf8")
    );

    await upsertCfnDiagramPreviewNotebook("# new diagram");

    const written = writtenNotebook();
    expect(written.cells).toHaveLength(2);
    expect(written.cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(written.cells[0].value).toBe("# new diagram");
    expect(written.cells[1].value).toBe("select 1");
  });

  it("inserts a new markdown cell at index 0 when the existing first cell isn't markdown", async () => {
    const existing = {
      cells: [{ kind: NotebookCellKind.Code, language: "sql", value: "select 1" }],
      metadata: {},
    };
    (workspace.fs.readFile as Mock).mockResolvedValue(
      Buffer.from(JSON.stringify(existing), "utf8")
    );

    await upsertCfnDiagramPreviewNotebook("# new diagram");

    const written = writtenNotebook();
    expect(written.cells).toHaveLength(2);
    expect(written.cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(written.cells[0].value).toBe("# new diagram");
    expect(written.cells[1].value).toBe("select 1");
  });

  it("inserts a new markdown cell when the existing file has no cells at all", async () => {
    const existing = { cells: [], metadata: {} };
    (workspace.fs.readFile as Mock).mockResolvedValue(
      Buffer.from(JSON.stringify(existing), "utf8")
    );

    await upsertCfnDiagramPreviewNotebook("# new diagram");

    const written = writtenNotebook();
    expect(written.cells).toHaveLength(1);
    expect(written.cells[0].value).toBe("# new diagram");
  });

  it("opens and reveals the written notebook", async () => {
    (workspace.fs.readFile as Mock).mockRejectedValue(new Error("ENOENT"));

    await upsertCfnDiagramPreviewNotebook("# hello");

    expect(workspace.openNotebookDocument).toHaveBeenCalledTimes(1);
    const [uri] = (workspace.openNotebookDocument as Mock).mock.calls[0];
    expect((uri as Uri).fsPath).toBe(`/workspace/${CFN_DIAGRAM_PREVIEW_FILE_NAME}`);
    expect(window.showNotebookDocument).toHaveBeenCalledWith(
      expect.anything(),
      { viewColumn: 2 }
    );
  });
});

describe("upsertCfnDiagramPreviewDrawio", () => {
  it("writes and opens the editable draw.io file", async () => {
    await upsertCfnDiagramPreviewDrawio("<mxfile />");

    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    const [uri, bytes] = (workspace.fs.writeFile as Mock).mock.calls[0];
    expect((uri as Uri).fsPath).toBe(`/workspace/${CFN_DIAGRAM_PREVIEW_DRAWIO_FILE_NAME}`);
    expect(decode(bytes)).toBe("<mxfile />");
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.anything(),
      "hediet.vscode-drawio-text",
      { viewColumn: 2 }
    );
  });

  it("shows an error and writes nothing when no workspace folder is open", async () => {
    setWorkspaceFolders(undefined);

    await upsertCfnDiagramPreviewDrawio("<mxfile />");

    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it("shows the generated path when the Draw.io editor cannot be opened", async () => {
    (commands.executeCommand as Mock).mockRejectedValueOnce(new Error("editor unavailable"));

    await upsertCfnDiagramPreviewDrawio("<mxfile />");

    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining(`/workspace/${CFN_DIAGRAM_PREVIEW_DRAWIO_FILE_NAME}`)
    );
  });
});
