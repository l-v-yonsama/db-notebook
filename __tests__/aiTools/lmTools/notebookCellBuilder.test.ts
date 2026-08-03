import { describe, expect, it, vi } from "vitest";
import { NotebookCellData, NotebookCellKind } from "vscode";
import type { StateStorage } from "../../../src/utilities/StateStorage";
import { CellInput, buildNotebookCells } from "../../../src/aiTools/lmTools/notebookCellBuilder";

type ConnectionFixture = { dbType?: string };

const makeStateStorage = (
  opts: {
    connections?: Record<string, ConnectionFixture>;
    mcpEnabled?: string[];
  } = {}
): StateStorage => {
  const connections = opts.connections ?? {};
  const mcpEnabled = new Set(opts.mcpEnabled ?? Object.keys(connections));
  return {
    getConnectionSettingByName: vi.fn(async (name: string) => connections[name]),
    getConnectionSettingNames: vi.fn(() => Object.keys(connections)),
    isMcpEnabledForConnection: vi.fn((name: string) => mcpEnabled.has(name)),
  } as unknown as StateStorage;
};

describe("buildNotebookCells", () => {
  it("空配列はエラーになる", async () => {
    const result = await buildNotebookCells(makeStateStorage(), [], undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/at least one cell/);
    }
  });

  it("mcpEnabledな接続を指定したSQLセルを構築できる", async () => {
    const stateStorage = makeStateStorage({ connections: { Prod: {} } });
    const cells: CellInput[] = [
      { kind: "code", language: "sql", value: "SELECT 1", metadata: { connectionName: "Prod" } },
    ];
    const result = await buildNotebookCells(stateStorage, cells, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cells).toHaveLength(1);
      const cell = result.cells[0] as NotebookCellData;
      expect(cell.kind).toBe(NotebookCellKind.Code);
      expect(cell.languageId).toBe("sql");
      expect(cell.metadata?.connectionName).toBe("Prod");
    }
  });

  it("markupセルはmarkdown言語のMarkupセルになり、接続名は不要", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "markup", value: "# Title" }],
      undefined
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cell = result.cells[0] as NotebookCellData;
      expect(cell.kind).toBe(NotebookCellKind.Markup);
      expect(cell.languageId).toBe("markdown");
    }
  });

  it("codeセルでlanguage未指定はエラー", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", value: "1+1" } as CellInput],
      undefined
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/language must be one of/);
    }
  });

  it("対応していないlanguageはエラー", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", language: "python", value: "1+1" }],
      undefined
    );
    expect(result.ok).toBe(false);
  });

  it("cwqlセルはmetadata.logGroupNameが無いとエラー", async () => {
    const stateStorage = makeStateStorage({ connections: { Logs: {} } });
    const result = await buildNotebookCells(
      stateStorage,
      [{ kind: "code", language: "cwql", value: "fields @message", metadata: { connectionName: "Logs" } }],
      undefined
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/logGroupName/);
    }
  });

  it("接続が必要な言語でconnectionNameが無い(デフォルトも無い)場合はエラー", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", language: "sql", value: "SELECT 1" }],
      undefined
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/needs a connectionName/);
    }
  });

  it("redisセルは接続が必要でconnectionNameが無い(デフォルトも無い)場合はエラー", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", language: "redis", value: "GET mykey" }],
      undefined
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/needs a connectionName/);
    }
  });

  it("redisセルはconnectionNameがあれば構築できる", async () => {
    const stateStorage = makeStateStorage({ connections: { RedisConn: {} } });
    const result = await buildNotebookCells(
      stateStorage,
      [
        {
          kind: "code",
          language: "redis",
          value: "GET mykey",
          metadata: { connectionName: "RedisConn" },
        },
      ],
      undefined
    );
    expect(result.ok).toBe(true);
  });

  it("トップレベルのdefaultConnectionNameが接続必須セルに適用される", async () => {
    const stateStorage = makeStateStorage({ connections: { Prod: {} } });
    const result = await buildNotebookCells(
      stateStorage,
      [{ kind: "code", language: "sql", value: "SELECT 1" }],
      "Prod"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.cells[0] as NotebookCellData).metadata?.connectionName).toBe("Prod");
    }
  });

  it("mcpEnabledでない接続名は拒否され、利用可能な接続一覧が返る", async () => {
    const stateStorage = makeStateStorage({
      connections: { Prod: {}, Dev: {} },
      mcpEnabled: ["Dev"],
    });
    const result = await buildNotebookCells(
      stateStorage,
      [{ kind: "code", language: "sql", value: "SELECT 1", metadata: { connectionName: "Prod" } }],
      undefined
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.availableConnectionNames).toEqual(["Dev"]);
    }
  });

  it("javascriptセルは接続名が無くても構築できる", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", language: "javascript", value: "console.log(1)" }],
      undefined
    );
    expect(result.ok).toBe(true);
  });

  it("typescriptセルは接続名が無くても構築できる", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", language: "typescript", value: "const x: number = 1; console.log(x)" }],
      undefined
    );
    expect(result.ok).toBe(true);
  });

  it("shellscriptセルは接続名が無くても構築できる", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", language: "shellscript", value: "echo hello" }],
      undefined
    );
    expect(result.ok).toBe(true);
  });

  it("batセルは接続名が無くても構築できる", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [{ kind: "code", language: "bat", value: "echo hello" }],
      undefined
    );
    expect(result.ok).toBe(true);
  });

  it("publishParams付きのjsonセル(MQTT publish)は接続名が必須", async () => {
    const result = await buildNotebookCells(
      makeStateStorage(),
      [
        {
          kind: "code",
          language: "json",
          value: "{}",
          metadata: { publishParams: { topicName: "t", qos: 0, retain: false } },
        },
      ],
      undefined
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/needs a connectionName/);
    }
  });
});
