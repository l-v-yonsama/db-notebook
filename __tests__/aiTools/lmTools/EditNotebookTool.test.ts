import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { workspace } from "vscode";
import type { NotebookDocument } from "vscode";
import type { StateStorage } from "../../../src/utilities/StateStorage";
import {
  applyOperations,
  EditOperation,
  validateOperations,
} from "../../../src/aiTools/lmTools/EditNotebookTool";

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

describe("validateOperations", () => {
  it("操作が0件なら常にok", async () => {
    const result = await validateOperations(makeStateStorage(), 3, []);
    expect(result.ok).toBe(true);
  });

  it("有効なindexへのinsertCellsはok", async () => {
    const ops: EditOperation[] = [
      { insertCells: { index: 2, cells: [{ kind: "markup", value: "# hi" }] } },
    ];
    const result = await validateOperations(makeStateStorage(), 3, ops);
    expect(result.ok).toBe(true);
  });

  it("範囲外のindexへのinsertCellsはエラー", async () => {
    const ops: EditOperation[] = [
      { insertCells: { index: 99, cells: [{ kind: "markup", value: "# hi" }] } },
    ];
    const result = await validateOperations(makeStateStorage(), 3, ops);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/out of range/);
    }
  });

  it("累積セル数: insertで増えた直後のセルをupdateCellMetadataで参照できる", async () => {
    const ops: EditOperation[] = [
      {
        insertCells: {
          index: 0,
          cells: [
            { kind: "markup", value: "# a" },
            { kind: "markup", value: "# b" },
          ],
        },
      },
      { updateCellMetadata: { cellIndex: 1, metadata: { markAsSkip: true } } },
    ];
    // 初期セル数0でも、直前のinsertCellsで2セル増えるのでcellIndex:1は有効
    const result = await validateOperations(makeStateStorage(), 0, ops);
    expect(result.ok).toBe(true);
  });

  it("累積セル数: deleteで減った後のindexは無効になる", async () => {
    const ops: EditOperation[] = [
      { deleteCells: { range: { start: 0, end: 3 } } },
      { updateCellMetadata: { cellIndex: 0, metadata: { markAsSkip: true } } },
    ];
    // 初期3セル中3セル削除、残り0セルなのでcellIndex:0はもう存在しない
    const result = await validateOperations(makeStateStorage(), 3, ops);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Operation 2/);
    }
  });

  it("endがstartより小さいrangeは無効", async () => {
    const ops: EditOperation[] = [{ deleteCells: { range: { start: 2, end: 1 } } }];
    const result = await validateOperations(makeStateStorage(), 5, ops);
    expect(result.ok).toBe(false);
  });

  it("endがcellCountを超えるrangeは無効", async () => {
    const ops: EditOperation[] = [{ deleteCells: { range: { start: 0, end: 10 } } }];
    const result = await validateOperations(makeStateStorage(), 5, ops);
    expect(result.ok).toBe(false);
  });

  it("replaceCellsはセル数の増減を正しく反映する", async () => {
    const ops: EditOperation[] = [
      {
        replaceCells: {
          range: { start: 0, end: 1 },
          cells: [
            { kind: "markup", value: "a" },
            { kind: "markup", value: "b" },
            { kind: "markup", value: "c" },
          ],
        },
      },
      // 元は1セル -> 3セルに置換されたので、cellCountは 3(元3) - 1 + 3 = 5 になっているはず
      { updateCellMetadata: { cellIndex: 4, metadata: { markAsSkip: true } } },
    ];
    const result = await validateOperations(makeStateStorage(), 3, ops);
    expect(result.ok).toBe(true);
  });

  it("mcpEnabledでないconnectionNameへのupdateCellMetadataは拒否される", async () => {
    const stateStorage = makeStateStorage({ connections: { Dev: {} }, mcpEnabled: ["Dev"] });
    const ops: EditOperation[] = [
      { updateCellMetadata: { cellIndex: 0, metadata: { connectionName: "Prod" } } },
    ];
    const result = await validateOperations(stateStorage, 1, ops);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.availableConnectionNames).toEqual(["Dev"]);
    }
  });

  it("複数キーが同時に指定された操作は不正", async () => {
    const malformed = {
      insertCells: { index: 0, cells: [{ kind: "markup", value: "a" }] },
      deleteCells: { range: { start: 0, end: 1 } },
    } as unknown as EditOperation;
    const result = await validateOperations(makeStateStorage(), 3, [malformed]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/specify exactly one of/);
    }
  });

  it("キーが1つも無い操作は不正", async () => {
    const empty = {} as unknown as EditOperation;
    const result = await validateOperations(makeStateStorage(), 3, [empty]);
    expect(result.ok).toBe(false);
  });

  it("updateCellSourceは範囲内のcellIndexならok", async () => {
    const ops: EditOperation[] = [{ updateCellSource: { cellIndex: 2, source: "SELECT 2" } }];
    const result = await validateOperations(makeStateStorage(), 3, ops);
    expect(result.ok).toBe(true);
  });

  it("updateCellSourceは範囲外のcellIndexだとエラー", async () => {
    const ops: EditOperation[] = [{ updateCellSource: { cellIndex: 3, source: "SELECT 2" } }];
    const result = await validateOperations(makeStateStorage(), 3, ops);
    expect(result.ok).toBe(false);
  });
});

const makeDocument = (): NotebookDocument =>
  ({
    uri: { toString: () => "file:///fake/test.dbnb" },
  } as unknown as NotebookDocument);

describe("applyOperations", () => {
  beforeEach(() => {
    (workspace.applyEdit as Mock).mockReset().mockResolvedValue(true);
  });

  it("workspace.applyEditがfalseを返した操作で処理を中断し、完了数を報告する", async () => {
    (workspace.applyEdit as Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const ops: EditOperation[] = [
      { deleteCells: { range: { start: 0, end: 1 } } },
      { deleteCells: { range: { start: 0, end: 1 } } },
      { deleteCells: { range: { start: 0, end: 1 } } },
    ];
    const result = await applyOperations(makeStateStorage(), makeDocument(), ops);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completed).toBe(1);
      expect(result.message).toMatch(/Operation 2\/3/);
      expect(result.message).toMatch(/applyEdit was rejected/);
    }
    // 3番目の操作は実行されないはず
    expect(workspace.applyEdit).toHaveBeenCalledTimes(2);
  });

  it("すべてのworkspace.applyEditがtrueを返せば全操作が完了として報告される", async () => {
    const ops: EditOperation[] = [
      { deleteCells: { range: { start: 0, end: 1 } } },
      { deleteCells: { range: { start: 0, end: 1 } } },
    ];
    const result = await applyOperations(makeStateStorage(), makeDocument(), ops);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.details).toHaveLength(2);
    }
    expect(workspace.applyEdit).toHaveBeenCalledTimes(2);
  });
});
