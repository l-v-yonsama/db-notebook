import { CancellationToken, NotebookCellKind, NotebookData } from "vscode";
import { describe, expect, it } from "vitest";
import { DBNotebookSerializer } from "../../src/notebook/serializer";
import {
  makeRpcCellData,
  RPC_CELL_LANGUAGE,
  RPC_RESPONSE_MIME,
  getRpcCellMetadata,
  isRpcCell,
} from "../../src/notebook/rpcCell";

const token = {} as CancellationToken;

describe("RPC notebook cell persistence", () => {
  it("keeps request settings while clearing response outputs", async () => {
    const cell = makeRpcCellData({
      connectionName: "localRPC",
      service: "rpcfixture.v1.TestTableService",
      method: "CreateTestTable",
      path: "/rpcfixture.v1.TestTableService/CreateTestTable",
      dataJson: '{"testTable":', // unfinished edits must survive a save
    });
    (cell.metadata as any).rpc.metadataJson = '{"x-request-id":'; // unfinished Metadata tab edits
    cell.outputs?.push({ items: [{ mime: RPC_RESPONSE_MIME, data: "secret response" }] } as any);

    const serializer = new DBNotebookSerializer();
    const bytes = await serializer.serializeNotebook(new NotebookData([cell]), token);
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    expect(raw.cells[0].outputs).toEqual([]);
    expect(raw.cells[0].value).toBe('{"testTable":');
    expect(raw.cells[0].metadata.rpc.metadataJson).toBe('{"x-request-id":');
    expect(raw.cells[0].language).toBe(RPC_CELL_LANGUAGE);

    const restored = await serializer.deserializeNotebook(bytes, token);
    expect(restored.cells[0].value).toBe('{"testTable":');
    expect(restored.cells[0].outputs).toHaveLength(0);
    expect((restored.cells[0].metadata as any).rpc.metadataJson).toBe('{"x-request-id":');
  });

  it("identifies a manually switched RPC JSON cell without changing its metadata", () => {
    const cell = {
      kind: NotebookCellKind.Code,
      metadata: {},
      document: { languageId: RPC_CELL_LANGUAGE, uri: { toString: () => "cell:1" } },
    } as any;
    expect(isRpcCell(cell)).toBe(true);
    expect(getRpcCellMetadata(cell).rpc.metadataJson).toBe("{}");
    expect(cell.metadata).toEqual({});
  });
});
