import {
  DBType,
  RpcDatabase,
  RpcMethod,
  RpcPackage,
  RpcService,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookCellKind, Uri, window, workspace } from "vscode";
import { RpcCellService } from "../../src/notebook/RpcCellService";
import {
  makeRpcCellData,
  RPC_RESPONSE_MIME,
} from "../../src/notebook/rpcCell";

const driverFactory = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../src/utilities/driverResolver", () => ({
  createDriver: driverFactory.create,
  removeDriver: driverFactory.remove,
}));

const methodPath = "/rpcfixture.v1.CustomerService/GetCustomer";

function createCell(dataJson: string) {
  const data = makeRpcCellData({
    connectionName: "localRPC",
    service: "rpcfixture.v1.CustomerService",
    method: "GetCustomer",
    path: methodPath,
    dataJson,
  });
  const notebook = { uri: Uri.file("/tmp/rpc-cell.dbn"), notebookType: "database-notebook-type" };
  let currentSource = dataJson;
  const document = {
    uri: Uri.file("/tmp/rpc-cell.dbn#cell1"),
    languageId: "rpc-json",
    getText: () => currentSource,
    setText: (value: string) => {
      currentSource = value;
    },
    positionAt: (offset: number) => offset,
  };
  return {
    kind: NotebookCellKind.Code,
    metadata: data.metadata,
    document,
    notebook,
    outputs: data.outputs,
    index: 0,
  } as any;
}

function createService(responseStream: boolean, requestStream = false) {
  const database = new RpcDatabase("rpcfixture.v1");
  const pkg = new RpcPackage("rpcfixture.v1");
  const service = new RpcService("CustomerService", "rpcfixture.v1.CustomerService");
  service.addChild(
    new RpcMethod(
      "GetCustomer",
      methodPath,
      "rpcfixture.v1.GetCustomerRequest",
      "rpcfixture.v1.Customer",
      requestStream,
      responseStream
    )
  );
  pkg.addChild(service);
  database.addChild(pkg);
  const stateStorage = {
    loadResource: vi.fn(async () => ({ ok: true, result: { db: [database], dbType: DBType.RPC } })),
    getConnectionSettingByName: vi.fn(async () => ({
      name: "localRPC",
      dbType: DBType.RPC,
      rpc: {},
    })),
  };
  const historyStore = { add: vi.fn(async () => undefined) };
  const context = { subscriptions: [] };
  return {
    cellService: new RpcCellService(context as any, stateStorage as any, historyStore as any),
    stateStorage,
    historyStore,
  };
}

function createExecution(cell: any) {
  const outputs: any[] = [];
  return {
    token: { onCancellationRequested: () => ({ dispose: () => {} }) },
    replaceOutput: vi.fn(async (next: any[]) => {
      outputs.splice(0, outputs.length, ...next);
    }),
    appendOutput: vi.fn(async (next: any) => {
      outputs.push(next);
    }),
    replaceOutputItems: vi.fn(async (items: any[], output: any) => {
      output.items = items;
    }),
    outputs,
  };
}

describe("RPC notebook execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one unary request, shows its response, records history, and disconnects", async () => {
    const driver = {
      connect: vi.fn(async () => ""),
      invokeUnaryProtoJson: vi.fn(async () => ({
        contents: { id: "42" },
        status: { code: 0, name: "OK" },
        elapsedMs: 12,
      })),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const { cellService, historyStore } = createService(false);
    const cell = createCell('{"id":"42"}');
    cell.metadata.rpc.metadataJson = '{"x-trace-id":"42"}';
    const execution = createExecution(cell);
    const success = await cellService.execute(cell, execution as any);

    expect(success).toBe(true);
    expect(driver.invokeUnaryProtoJson).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "rpcfixture.v1.CustomerService",
        method: "GetCustomer",
        requestJson: '{"id":"42"}',
        metadata: { "x-trace-id": "42" },
      })
    );
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(driverFactory.remove).toHaveBeenCalledWith(driver);
    expect(historyStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        callKind: "unary",
        sentCount: 1,
        receivedCount: 1,
        outcome: "success",
        requestMetadata: { "x-trace-id": "42" },
      })
    );
    expect(execution.replaceOutput).toHaveBeenCalledTimes(1);
    expect(execution.appendOutput).not.toHaveBeenCalled();
    expect(execution.outputs).toHaveLength(1);
    expect(execution.outputs[0].items[0].mime).toBe(RPC_RESPONSE_MIME);
    expect(execution.outputs[0].items[0].data.contents).toEqual({ id: "42" });
    expect(execution.outputs[0].items[1].data).toContain("OK(0) · 1 Received (0.012 sec)");
  });

  it("rejects invalid input before connecting or adding history", async () => {
    const { cellService, historyStore } = createService(false);
    const cell = createCell('{"id":');
    const execution = createExecution(cell);
    const success = await cellService.execute(cell, execution as any);

    expect(success).toBe(false);
    expect(driverFactory.create).not.toHaveBeenCalled();
    expect(historyStore.add).not.toHaveBeenCalled();
    expect(execution.outputs).toHaveLength(1);
    expect(execution.outputs[0].items[0].data.outcome).toBe("error");
  });

  it("handles a language-switched RPC cell with no saved settings", async () => {
    const { cellService } = createService(false);
    const cell = createCell("{}");
    cell.metadata = {};
    const execution = createExecution(cell);

    expect(await cellService.execute(cell, execution as any)).toBe(false);
    expect(driverFactory.create).not.toHaveBeenCalled();
    expect(execution.outputs[0].items[0].data.error).toContain("Select an RPC connection and method");
    expect(cell.metadata).toEqual({});
  });

  it("keeps a server stream as one execution and one history entry", async () => {
    const session = {
      events: (async function* () {
        yield { type: "headers", headers: { "x-call": ["demo"] } };
        yield { type: "received", index: 1, at: 100, contents: { id: "1" } };
        yield { type: "received", index: 2, at: 101, contents: { id: "2" } };
      })(),
      completion: Promise.resolve({
        sentCount: 1,
        receivedCount: 2,
        outcome: "success",
        elapsedMs: 30,
        status: { code: 0, name: "OK" },
      }),
      cancel: vi.fn(),
    };
    const driver = {
      connect: vi.fn(async () => ""),
      openProtoJsonStream: vi.fn(() => session),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const { cellService, historyStore } = createService(true);
    const cell = createCell("{}");
    const execution = createExecution(cell);
    const success = await cellService.execute(cell, execution as any);

    expect(success).toBe(true);
    expect(driver.openProtoJsonStream).toHaveBeenCalledTimes(1);
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        callKind: "serverStreaming",
        sentCount: 1,
        receivedCount: 2,
        outcome: "success",
      })
    );
    expect(execution.outputs[0].items[0].data.messages).toHaveLength(2);
  });

  it.each([
    { kind: "clientStreaming", responseStream: false, receivedCount: 1 },
    { kind: "bidiStreaming", responseStream: true, receivedCount: 2 },
  ])("sends a prepared array for $kind and records one stream", async ({
    kind,
    responseStream,
    receivedCount,
  }) => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    let listening = false;
    const sent: string[] = [];
    const session = {
      events: (async function* () {
        listening = true;
        await finished;
        for (let index = 1; index <= receivedCount; index++) {
          yield { type: "received", index, at: index, contents: { value: `reply-${index}` } };
        }
      })(),
      completion: finished.then(() => ({
        sentCount: 2,
        receivedCount,
        outcome: "success",
        elapsedMs: 20,
        status: { code: 0, name: "OK" },
      })),
      send: vi.fn(async (requestJson: string) => {
        expect(listening).toBe(true);
        sent.push(requestJson);
      }),
      finishSending: vi.fn(async () => { finish(); }),
      cancel: vi.fn(),
    };
    const driver = {
      connect: vi.fn(async () => ""),
      openProtoJsonStream: vi.fn(() => session),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const { cellService, historyStore } = createService(responseStream, true);
    const cell = createCell('[{"value":"first"},{"value":"second"}]');
    const execution = createExecution(cell);

    expect(await cellService.execute(cell, execution as any)).toBe(true);
    expect(driver.openProtoJsonStream).toHaveBeenCalledWith(
      expect.objectContaining({ requestJson: undefined, metadata: {} })
    );
    expect(sent.map((item) => JSON.parse(item))).toEqual([{ value: "first" }, { value: "second" }]);
    expect(session.finishSending).toHaveBeenCalledTimes(1);
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledWith(
      expect.objectContaining({ callKind: kind, sentCount: 2, receivedCount, outcome: "success" })
    );
    expect(historyStore.add.mock.calls[0][0].requestCapture.finish().requestJson)
      .toBe('[{"value":"first"},{"value":"second"}]');
    expect(execution.outputs[0].items[0].data.messages).toHaveLength(receivedCount);
    expect(execution.outputs[0].items[0].data.sentCount).toBe(2);
  });

  it("rejects a single object for a client stream before connecting", async () => {
    const { cellService, historyStore } = createService(false, true);
    const cell = createCell('{"value":"first"}');
    const execution = createExecution(cell);

    expect(await cellService.execute(cell, execution as any)).toBe(false);
    expect(driverFactory.create).not.toHaveBeenCalled();
    expect(historyStore.add).not.toHaveBeenCalled();
    expect(execution.outputs[0].items[0].data.error).toContain("JSON array");
  });

  it("uses an array template when a request-stream method is selected", async () => {
    const { cellService } = createService(false, true);
    const cell = createCell("[]");
    vi.mocked(window.showQuickPick).mockImplementation(async (choices: any) => choices[0]);
    vi.mocked(workspace.applyEdit).mockImplementation(async (edit: any) => {
      const metadataEdit = edit.get(cell.notebook.uri)[0];
      if (metadataEdit) {
        cell.metadata = metadataEdit.metadata;
      }
      const textEdit = edit.get(cell.document.uri)[0];
      if (textEdit) {
        cell.document.setText(textEdit.newText);
      }
      return true;
    });

    await cellService.selectMethod(cell);

    expect(cell.metadata.rpc.callKind).toBe("clientStreaming");
    expect(JSON.parse(cell.document.getText())).toEqual([{}]);
  });

  it("records one history entry even when an empty client stream sends zero messages", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const session = {
      events: (async function* () {})(),
      completion: finished.then(() => ({
        sentCount: 0,
        receivedCount: 1,
        outcome: "success",
        elapsedMs: 3,
        status: { code: 0, name: "OK" },
      })),
      send: vi.fn(),
      finishSending: vi.fn(async () => finish()),
      cancel: vi.fn(),
    };
    const driver = {
      connect: vi.fn(async () => ""),
      openProtoJsonStream: vi.fn(() => session),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const { cellService, historyStore } = createService(false, true);
    const cell = createCell("[]");

    expect(await cellService.execute(cell, createExecution(cell) as any)).toBe(true);
    expect(session.send).not.toHaveBeenCalled();
    expect(session.finishSending).toHaveBeenCalledTimes(1);
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledWith(
      expect.objectContaining({ callKind: "clientStreaming", sentCount: 0, outcome: "success" })
    );
  });

  it("cancels and disconnects when a prepared stream message fails to send", async () => {
    let finish!: (value: unknown) => void;
    let rendered!: () => void;
    const partialResponseRendered = new Promise<void>((resolve) => { rendered = resolve; });
    const session = {
      events: (async function* () {
        yield { type: "received", index: 1, at: 1, contents: { value: "partial" } };
      })(),
      completion: new Promise((resolve) => { finish = resolve; }),
      send: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => {
          await partialResponseRendered;
          throw new Error("Invalid request message");
        }),
      finishSending: vi.fn(),
      cancel: vi.fn(() => finish({
        sentCount: 1,
        receivedCount: 1,
        outcome: "cancelled",
        elapsedMs: 5,
      })),
    };
    const driver = {
      connect: vi.fn(async () => ""),
      openProtoJsonStream: vi.fn(() => session),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const { cellService, historyStore } = createService(false, true);
    const cell = createCell('[{"value":"first"},{"value":"bad"}]');
    const execution = createExecution(cell);
    execution.replaceOutputItems.mockImplementation(async (items: any[], output: any) => {
      output.items = items;
      rendered();
    });

    expect(await cellService.execute(cell, execution as any)).toBe(false);
    expect(session.cancel).toHaveBeenCalled();
    expect(session.finishSending).not.toHaveBeenCalled();
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledWith(
      expect.objectContaining({ callKind: "clientStreaming", sentCount: 1, receivedCount: 1, outcome: "error" })
    );
    expect(execution.outputs[0].items[0].data.error).toContain("Invalid request message");
    expect(execution.outputs[0].items[0].data.messages).toEqual([
      { index: 1, at: 1, contents: { value: "partial" } },
    ]);
  });

  it("releases the owned driver when cancelled during connection", async () => {
    let finishConnect!: (value: string) => void;
    const driver = {
      connect: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finishConnect = resolve;
          })
      ),
      invokeUnaryProtoJson: vi.fn(),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const { cellService, historyStore } = createService(false);
    const cell = createCell("{}");
    const execution = createExecution(cell);
    const running = cellService.execute(cell, execution as any);
    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalledTimes(1));

    cellService.cancelNotebook(cell.notebook.uri.toString());
    finishConnect("");
    expect(await running).toBe(false);
    expect(driver.invokeUnaryProtoJson).not.toHaveBeenCalled();
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(driverFactory.remove).toHaveBeenCalledWith(driver);
    expect(historyStore.add).not.toHaveBeenCalled();
  });

  it("reads current cell text and saved metadata without a request output", async () => {
    const driver = {
      connect: vi.fn(async () => ""),
      invokeUnaryProtoJson: vi.fn(async () => ({
        contents: { id: "latest" },
        status: { code: 0, name: "OK" },
        elapsedMs: 2,
      })),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const cell = createCell('{"id":"latest"}');
    cell.metadata.rpc.metadataJson = '{"x-request-id":"demo"}';
    const { cellService } = createService(false);
    const execution = createExecution(cell);
    expect(await cellService.execute(cell, execution as any)).toBe(true);
    expect(driver.invokeUnaryProtoJson).toHaveBeenCalledWith(
      expect.objectContaining({
        requestJson: '{"id":"latest"}',
        metadata: { "x-request-id": "demo" },
      })
    );
    expect(execution.outputs).toHaveLength(1);
    expect(execution.outputs[0].items[0].mime).toBe(RPC_RESPONSE_MIME);
    expect(cell.metadata.rpc.metadataJson).toBe('{"x-request-id":"demo"}');
  });

  it("cancels one server stream and records its terminal state once", async () => {
    let finish!: (value: unknown) => void;
    const session = {
      events: (async function* () {})(),
      completion: new Promise((resolve) => {
        finish = resolve;
      }),
      cancel: vi.fn(() =>
        finish({
          sentCount: 1,
          receivedCount: 0,
          outcome: "cancelled",
          elapsedMs: 5,
        })
      ),
    };
    const driver = {
      connect: vi.fn(async () => ""),
      openProtoJsonStream: vi.fn(() => session),
      disconnect: vi.fn(async () => ""),
    };
    driverFactory.create.mockResolvedValue(driver);
    const { cellService, historyStore } = createService(true);
    const cell = createCell("{}");
    const execution = createExecution(cell);
    const running = cellService.execute(cell, execution as any);
    await vi.waitFor(() => expect(driver.openProtoJsonStream).toHaveBeenCalledTimes(1));

    cellService.cancelNotebook(cell.notebook.uri.toString());
    expect(await running).toBe(false);
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledTimes(1);
    expect(historyStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        callKind: "serverStreaming",
        outcome: "cancelled",
        sentCount: 1,
      })
    );
  });
});
