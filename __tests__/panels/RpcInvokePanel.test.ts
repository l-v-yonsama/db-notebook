import {
  DBType,
  RpcMessage,
  RpcInvokeError,
  RpcMethod,
  RpcService,
  type ConnectionSetting,
  type UnaryResult,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, window } from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcInvokePanel } from "../../src/panels/RpcInvokePanel";
import { createDriver, removeDriver, workflow } from "../../src/utilities/driverResolver";
import type { ResourceTreeProvider } from "../../src/treeData/resource/ResourceTreeProvider";
import type { StateStorage } from "../../src/utilities/StateStorage";
import type { RpcInvokeHistoryStore } from "../../src/utilities/RpcInvokeHistoryStore";

vi.mock("../../src/utilities/driverResolver", () => ({
  createDriver: vi.fn(),
  removeDriver: vi.fn(),
  workflow: vi.fn(),
}));

const setting: ConnectionSetting = {
  name: "fixture",
  dbType: DBType.RPC,
  host: "localhost",
  port: 65052,
  ssl: { use: true },
  rpc: {
    protoFilePath: "/fixture.proto",
    authentication: { type: "bearer", token: "fixture-secret" },
  },
};

const method = new RpcMethod(
  "GetCustomer",
  "/rpcfixture.v1.CustomerService/GetCustomer",
  "rpcfixture.v1.GetCustomerRequest",
  "rpcfixture.v1.Customer"
);
const service = new RpcService("CustomerService", "rpcfixture.v1.CustomerService", "advertised");
service.addChild(method);
method.addChild(
  new RpcMessage("GetCustomerRequest", "rpcfixture.v1.GetCustomerRequest", "request")
);
method.addChild(new RpcMessage("Customer", "rpcfixture.v1.Customer", "response"));

const getConnectionSettingByName = vi.fn(async () => setting);
const getLoadedRpcMethodContext = vi.fn(() => ({ connection: { name: "fixture" }, service }));
const storage = {
  getConnectionSettingByName,
  getPreviousSaveFolder: vi.fn(async () => undefined),
  setPreviousSaveFolder: vi.fn(async () => undefined),
} as unknown as StateStorage;
const tree = { getLoadedRpcMethodContext } as unknown as ResourceTreeProvider;
const addHistory = vi.fn().mockResolvedValue(undefined);

const currentPanel = () => vi.mocked(window.createWebviewPanel).mock.results.at(-1)!.value;
const messages = () =>
  currentPanel().webview.postMessage.mock.calls.map((call: unknown[]) => call[0]);
const send = async (message: unknown) => {
  const listener = currentPanel().webview.onDidReceiveMessage.mock.calls[0][0];
  await listener(message);
};

const selectClientStream = () => {
  const streamMethod = new RpcMethod(
    "ClientStream",
    "/rpcfixture.v1.StreamingTestService/ClientStream",
    "rpcfixture.v1.StreamItem",
    "rpcfixture.v1.StreamSummary",
    true,
    false
  );
  const streamService = new RpcService(
    "StreamingTestService",
    "rpcfixture.v1.StreamingTestService",
    "advertised"
  );
  streamService.addChild(streamMethod);
  getLoadedRpcMethodContext.mockReturnValue({ connection: { name: "fixture" }, service: streamService });
  RpcInvokePanel.render(Uri.file("/extension"), storage, tree, streamMethod, streamService, "fixture");
  return { streamMethod, streamService };
};

const startClientStream = async (streamMethod: RpcMethod, streamService: RpcService) =>
  send({
    command: "startRpcStream",
    params: {
      connectionName: "fixture",
      service: streamService.fullName,
      method: streamMethod.name,
      requestJson: "{}",
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  RpcInvokePanel.setHistoryStore({ add: addHistory } as unknown as RpcInvokeHistoryStore);
  vi.mocked(createDriver).mockReset();
  getLoadedRpcMethodContext.mockReturnValue({ connection: { name: "fixture" }, service });
  RpcInvokePanel.render(Uri.file("/extension"), storage, tree, method, service, "fixture");
});

afterEach(() => {
  currentPanel().onDidDispose.mock.calls[0]?.[0]();
  RpcInvokePanel.setHistoryStore(undefined);
});

describe("RpcInvokePanel", () => {
  it("exports the executed unary request and response through the shared HTML report", async () => {
    const targetPath = path.join(os.tmpdir(), `rpc-panel-${Date.now()}.html`);
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(Uri.file(targetPath));
    vi.mocked(workflow).mockResolvedValue({
      ok: true, message: "", result: {
        contents: { id: "7", name: "Aki" },
        status: { code: 0, name: "OK", details: "" },
        elapsedMs: 9,
      },
    });
    try {
      await send({ command: "invokeRpc", params: {
        connectionName: "fixture", service: service.fullName, method: method.name,
        requestJson: '{"id":"7"}', metadata: { "x-trace-id": "abc-123" },
      } });
      expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({
        requestMetadata: { "x-trace-id": "abc-123" },
      }));
      expect(messages().some((message) => message.command === "reportAvailable" && message.value.reportAvailable)).toBe(true);
      await send({ command: "outputRpcHtml", params: {} });
      const html = await fs.promises.readFile(targetPath, "utf8");
      expect(html).toContain("Aki");
      expect(html).toContain("id");
      expect(html).toContain("1 Sent, 1 Received (0.009 sec)");
      expect(html).toContain("x-trace-id");
      expect(html).toContain("abc-123");
      expect(html).toContain('data-tab="metadata" data-id-class="id0_request_tab"');
      expect(html).toContain('data-tab="descriptor" data-id-class="id0_0_rpc_tab"');
      expect(html).not.toContain("fixture-secret");
      await send({ command: "invokeRpc", params: {
        connectionName: "fixture", service: service.fullName, method: method.name,
        requestJson: "{broken",
      } });
      expect(messages().at(-1).command).toBe("error");
      await send({ command: "outputRpcHtml", params: {} });
      expect(window.showSaveDialog).toHaveBeenCalledTimes(1);
    } finally {
      await fs.promises.unlink(targetPath).catch(() => undefined);
    }
  });

  it("exports the actual sent and received stream messages", async () => {
    const { streamMethod, streamService } = selectClientStream();
    const targetPath = path.join(os.tmpdir(), `rpc-stream-${Date.now()}.html`);
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(Uri.file(targetPath));
    const session = {
      kind: "clientStreaming",
      events: { async *[Symbol.asyncIterator]() {
        yield { type: "sent", index: 1, at: 1000, contents: { name: "actually sent" } };
        yield { type: "received", index: 1, at: 2000, contents: { count: 1 } };
      } },
      completion: Promise.resolve({
        outcome: "success", status: { code: 0, name: "OK", details: "" },
        elapsedMs: 30, sentCount: 1, receivedCount: 1,
      }),
      send: vi.fn(), finishSending: vi.fn(), cancel: vi.fn(),
    };
    vi.mocked(createDriver).mockResolvedValue({
      connect: vi.fn().mockResolvedValue(""),
      openProtoJsonStream: vi.fn().mockReturnValue(session),
      disconnect: vi.fn().mockResolvedValue(""),
    } as any);
    try {
      await startClientStream(streamMethod, streamService);
      await vi.waitFor(() => expect(messages().some((message) => message.command === "reportAvailable" && message.value.reportAvailable)).toBe(true));
      await send({ command: "outputRpcHtml", params: {} });
      const html = await fs.promises.readFile(targetPath, "utf8");
      expect(html).toContain("actually sent");
      expect(html).toContain("count");
      expect(html).toContain("1 Sent, 1 Received (0.030 sec)");
      expect(html).not.toContain("fixture-secret");
    } finally {
      await fs.promises.unlink(targetPath).catch(() => undefined);
    }
  });
  it("loads the selected unary method and renders status, JSON, headers and trailers", async () => {
    const response: UnaryResult = {
      contents: { id: "1", name: "Hana" },
      status: { code: 0, name: "OK", details: "" },
      elapsedMs: 8,
      headers: { "x-rpc-tag": ["first"] },
      trailers: { "x-rpc-trailer": ["complete"] },
    };
    vi.mocked(workflow).mockResolvedValue({ ok: true, message: "", result: response });
    await send({ command: "ready", params: {} });
    expect(messages().find((message) => message.command === "initialize")).toMatchObject({
      command: "initialize",
      value: {
        initialize: {
          connectionName: "fixture",
          service: service.fullName,
          method: method.name,
          requestDescriptionHtml: expect.stringContaining(
            '<span class="token keyword">message</span>'
          ),
          responseDescription: expect.stringContaining("message Customer {"),
          responseDescriptionHtml: expect.stringContaining(
            '<span class="token keyword">message</span>'
          ),
        },
      },
    });

    const requestJson = '{"id":"1"}';
    await send({
      command: "invokeRpc",
      params: {
        connectionName: "fixture",
        service: service.fullName,
        method: method.name,
        requestJson,
        metadata: { "x-request-id": "abc" },
      },
    });
    expect(workflow).toHaveBeenCalledWith(setting, expect.any(Function), false);
    const invokeUnaryProtoJson = vi.fn().mockResolvedValue(response);
    const run = vi.mocked(workflow).mock.calls.at(-1)![1];
    await run({ invokeUnaryProtoJson } as any);
    expect(invokeUnaryProtoJson).toHaveBeenCalledWith({
      service: service.fullName,
      method: method.name,
      requestJson,
      metadata: { "x-request-id": "abc" },
    });
    expect(messages().at(-1)).toMatchObject({
      command: "result",
      value: { result: { status: response.status, elapsedMs: 8 } },
    });
    const html = messages().at(-1).value.result;
    expect(html.contentsHtml).toContain("Hana");
    expect(html.headersHtml).toContain("x-rpc-tag");
    expect(html.trailersHtml).toContain("x-rpc-trailer");
    expect(addHistory).toHaveBeenCalledTimes(1);
    expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({
      path: method.path,
      callKind: "unary",
      outcome: "success",
      sentCount: 1,
      receivedCount: 1,
      grpcStatus: { code: 0, name: "OK" },
      requestMetadata: { "x-request-id": "abc" },
    }));
    expect(addHistory.mock.calls[0][0].requestCapture.finish().requestJson).toBe(requestJson);
    expect(JSON.stringify(addHistory.mock.calls)).not.toContain("Hana");
    expect(JSON.stringify(addHistory.mock.calls)).not.toContain("x-rpc-tag");
  });

  it("restores a history request when reopening the same method without executing it", () => {
    RpcInvokePanel.render(
      Uri.file("/extension"), storage, tree, method, service, "fixture", {
        requestJson: '{"id":"first"}',
        requestMetadata: { "x-request-id": "first" },
      }
    );
    const first = messages().at(-1).value.initialize;
    expect(first.restoredRequestJson).toBe('{"id":"first"}');
    expect(first.restoredMetadataJson).toContain('"x-request-id": "first"');
    expect(first.restoreId).toEqual(expect.any(String));
    RpcInvokePanel.render(
      Uri.file("/extension"), storage, tree, method, service, "fixture", {
        requestJson: '{"id":"second"}',
      }
    );
    const second = messages().at(-1).value.initialize;
    expect(second.restoredRequestJson).toBe('{"id":"second"}');
    expect(second.restoredMetadataJson).toBeUndefined();
    expect(second.restoreId).not.toBe(first.restoreId);
    expect(workflow).not.toHaveBeenCalled();
  });

  it("rejects stale methods and forged metadata before running a workflow", async () => {
    getLoadedRpcMethodContext.mockReturnValueOnce(undefined as any);
    await send({
      command: "invokeRpc",
      params: {
        connectionName: "fixture",
        service: service.fullName,
        method: method.name,
        requestJson: "{}",
      },
    });
    expect(messages().at(-1).value.error).toContain("schema has changed");
    await send({
      command: "invokeRpc",
      params: {
        connectionName: "fixture",
        service: service.fullName,
        method: method.name,
        requestJson: "{}",
        metadata: { authorization: "Bearer forged" },
      },
    });
    expect(messages().at(-1).value.error).toContain("authorization metadata");
    await send({
      command: "invokeRpc",
      params: {
        connectionName: "fixture",
        service: service.fullName,
        method: method.name,
        requestJson: "{}",
        metadata: { "x-payload-bin": "YWJj" },
      },
    });
    expect(messages().at(-1).value.error).toContain("Binary RPC metadata");
    expect(workflow).not.toHaveBeenCalled();
    expect(addHistory).not.toHaveBeenCalled();
  });

  it("does not record invalid JSON as an invocation", async () => {
    await send({
      command: "invokeRpc",
      params: {
        connectionName: "fixture",
        service: service.fullName,
        method: method.name,
        requestJson: "{broken",
      },
    });
    expect(workflow).not.toHaveBeenCalled();
    expect(addHistory).not.toHaveBeenCalled();
  });

  it("shows statusCode failures without exposing the saved Bearer token", async () => {
    vi.mocked(workflow).mockResolvedValue({
      ok: false,
      message: "denied fixture-secret statusCode:16",
    });
    await send({
      command: "invokeRpc",
      params: {
        connectionName: "fixture",
        service: service.fullName,
        method: method.name,
        requestJson: "{}",
      },
    });
    expect(messages().at(-1)).toMatchObject({
      command: "error",
      value: { error: "denied [redacted] statusCode:16" },
    });
    expect(addHistory).toHaveBeenCalledTimes(1);
    expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
    expect(JSON.stringify(addHistory.mock.calls)).not.toContain("fixture-secret");
    expect(JSON.stringify(addHistory.mock.calls)).not.toContain("denied");
  });

  it("keeps a unary deadline status in history and the response report", async () => {
    vi.mocked(workflow).mockImplementation(async (_setting, run) => {
      try {
        await run({
          invokeUnaryProtoJson: async () => {
            throw new RpcInvokeError("deadline exceeded", {
              kind: "grpc",
              status: { code: 4, name: "DEADLINE_EXCEEDED", details: "deadline exceeded" },
            });
          },
        } as any);
      } catch (error) {
        return { ok: false, message: (error as Error).message } as any;
      }
      throw new Error("Expected an RPC failure");
    });
    await send({
      command: "invokeRpc",
      params: {
        connectionName: "fixture",
        service: service.fullName,
        method: method.name,
        requestJson: "{}",
      },
    });
    expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "timeout",
      grpcStatus: { code: 4, name: "DEADLINE_EXCEEDED" },
    }));
    expect((RpcInvokePanel as any).currentPanel.reportResult).toMatchObject({
      outcome: "timeout",
      status: { code: 4, name: "DEADLINE_EXCEEDED" },
    });
  });

  it("routes a bidirectional stream through a dedicated driver and releases it", async () => {
    const streamMethod = new RpcMethod(
      "BidiStream",
      "/rpcfixture.v1.StreamingTestService/BidiStream",
      "rpcfixture.v1.StreamItem",
      "rpcfixture.v1.StreamItem",
      true,
      true
    );
    const streamService = new RpcService(
      "StreamingTestService",
      "rpcfixture.v1.StreamingTestService",
      "advertised"
    );
    streamService.addChild(streamMethod);
    getLoadedRpcMethodContext.mockReturnValue({ connection: { name: "fixture" }, service: streamService });
    RpcInvokePanel.render(Uri.file("/extension"), storage, tree, streamMethod, streamService, "fixture");

    let complete!: (value: unknown) => void;
    const completion = new Promise((resolve) => { complete = resolve; });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const finishSending = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    const session = {
      kind: "bidiStreaming",
      events: {
        async *[Symbol.asyncIterator]() {
          yield { type: "received", index: 1, at: 1, contents: { value: "ok" } };
        },
      },
      completion,
      send: sendMessage,
      finishSending,
      cancel,
    };
    const driver = {
      connect: vi.fn().mockResolvedValue(""),
      openProtoJsonStream: vi.fn().mockReturnValue(session),
      disconnect: vi.fn().mockResolvedValue(""),
    };
    vi.mocked(createDriver).mockResolvedValue(driver as any);
    await send({
        command: "startRpcStream",
        params: {
          connectionName: "fixture",
          service: streamService.fullName,
          method: streamMethod.name,
          requestJson: "{}",
          metadata: { "x-request-id": "stream-test" },
        },
    });
    expect(createDriver).toHaveBeenCalledWith(setting, false);
    expect(driver.connect).toHaveBeenCalledTimes(1);
    expect(driver.openProtoJsonStream).toHaveBeenCalledWith({
        service: streamService.fullName,
        method: streamMethod.name,
        requestJson: undefined,
        metadata: { "x-request-id": "stream-test" },
    });
    const started = messages().find((message) => message.command === "streamStarted");
    const sessionId = started.value.streamStarted.sessionId;
    await send({ command: "sendRpcStreamMessage", params: { sessionId, requestJson: '{"value":"first"}' } });
    await send({ command: "finishRpcStreamSending", params: { sessionId } });
    await send({ command: "cancelRpcStream", params: { sessionId } });
    expect(sendMessage).toHaveBeenCalledWith('{"value":"first"}');
    expect(finishSending).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    complete({ outcome: "cancelled", elapsedMs: 5, sentCount: 1, receivedCount: 1 });
    await vi.waitFor(() => {
      expect(messages().some((message) => message.command === "streamCompleted")).toBe(true);
    });
    expect(addHistory).toHaveBeenCalledTimes(1);
    expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({
      path: streamMethod.path,
      callKind: "bidiStreaming",
      outcome: "cancelled",
      sentCount: 1,
      receivedCount: 1,
      requestMetadata: { "x-request-id": "stream-test" },
    }));
    expect(addHistory.mock.calls[0][0].requestCapture.finish().requestJson).toBe('[{"value":"first"}]');
    expect(messages().find((message) => message.command === "streamEvent")).toMatchObject({
      value: { streamEvent: { sessionId, event: { type: "received", contents: { value: "ok" } } } },
    });
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(removeDriver).toHaveBeenCalledWith(driver);
  });

  it("cancels and releases an active stream when the panel closes", async () => {
    const { streamMethod, streamService } = selectClientStream();
    const session = {
      kind: "clientStreaming",
      events: { async *[Symbol.asyncIterator]() { /* No messages. */ } },
      completion: new Promise(() => undefined),
      send: vi.fn(),
      finishSending: vi.fn(),
      cancel: vi.fn(),
    };
    const driver = {
      connect: vi.fn().mockResolvedValue(""),
      openProtoJsonStream: vi.fn().mockReturnValue(session),
      disconnect: vi.fn().mockResolvedValue(""),
    };
    vi.mocked(createDriver).mockResolvedValue(driver as any);
    await startClientStream(streamMethod, streamService);
    currentPanel().onDidDispose.mock.calls[0][0]();
    await vi.waitFor(() => {
      expect(driver.disconnect).toHaveBeenCalledTimes(1);
      expect(removeDriver).toHaveBeenCalledWith(driver);
    });
    expect(session.cancel).toHaveBeenCalledTimes(1);
  });

  it("records one server-streaming request for restoration", async () => {
    const streamMethod = new RpcMethod(
      "Watch", "/rpcfixture.v1.StreamingTestService/Watch", "rpcfixture.v1.WatchRequest",
      "rpcfixture.v1.StreamItem", false, true
    );
    const streamService = new RpcService(
      "StreamingTestService", "rpcfixture.v1.StreamingTestService", "advertised"
    );
    streamService.addChild(streamMethod);
    getLoadedRpcMethodContext.mockReturnValue({ connection: { name: "fixture" }, service: streamService });
    RpcInvokePanel.render(Uri.file("/extension"), storage, tree, streamMethod, streamService, "fixture");
    const session = {
      kind: "serverStreaming",
      events: { async *[Symbol.asyncIterator]() { /* No messages. */ } },
      completion: Promise.resolve({ outcome: "success", elapsedMs: 3, sentCount: 1, receivedCount: 2 }),
      cancel: vi.fn(),
    };
    vi.mocked(createDriver).mockResolvedValue({
      connect: vi.fn().mockResolvedValue(""),
      openProtoJsonStream: vi.fn().mockReturnValue(session),
      disconnect: vi.fn().mockResolvedValue(""),
    } as any);
    await send({
      command: "startRpcStream",
      params: {
        connectionName: "fixture",
        service: streamService.fullName,
        method: streamMethod.name,
        requestJson: '{"filter":"recent"}',
        metadata: { "x-request-id": "not-saved" },
      },
    });
    await vi.waitFor(() => expect(addHistory).toHaveBeenCalledTimes(1));
    expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({
      callKind: "serverStreaming",
      sentCount: 1,
      receivedCount: 2,
      requestMetadata: { "x-request-id": "not-saved" },
    }));
    expect(addHistory.mock.calls[0][0].requestCapture.finish().requestJson).toBe('{"filter":"recent"}');
  });

  it("releases the dedicated driver when connect or stream creation fails", async () => {
    const { streamMethod, streamService } = selectClientStream();
    const driver = {
      connect: vi.fn().mockResolvedValue("connection failed"),
      openProtoJsonStream: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(""),
    };
    vi.mocked(createDriver).mockResolvedValue(driver as any);
    await startClientStream(streamMethod, streamService);
    expect(driver.openProtoJsonStream).not.toHaveBeenCalled();
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(removeDriver).toHaveBeenCalledWith(driver);
    expect(messages().at(-1).value.streamError.error).toContain("connection failed");

    driver.connect.mockResolvedValue("");
    driver.openProtoJsonStream.mockImplementation(() => { throw new Error("invalid method"); });
    await startClientStream(streamMethod, streamService);
    expect(driver.disconnect).toHaveBeenCalledTimes(2);
    expect(removeDriver).toHaveBeenCalledTimes(2);
    expect(messages().at(-1).value.streamError.error).toContain("invalid method");
    expect(addHistory).toHaveBeenCalledTimes(2);
    expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({
      callKind: "clientStreaming", outcome: "error", sentCount: 0, receivedCount: 0,
    }));
  });

  it("records a timed out stream once with final counts and status", async () => {
    const { streamMethod, streamService } = selectClientStream();
    const session = {
      kind: "clientStreaming",
      events: { async *[Symbol.asyncIterator]() { /* No messages. */ } },
      completion: Promise.resolve({
        outcome: "timeout",
        status: { code: 4, name: "DEADLINE_EXCEEDED", details: "secret detail" },
        elapsedMs: 20,
        sentCount: 2,
        receivedCount: 1,
      }),
      cancel: vi.fn(),
    };
    const driver = {
      connect: vi.fn().mockResolvedValue(""),
      openProtoJsonStream: vi.fn().mockReturnValue(session),
      disconnect: vi.fn().mockResolvedValue(""),
    };
    vi.mocked(createDriver).mockResolvedValue(driver as any);
    await startClientStream(streamMethod, streamService);
    await vi.waitFor(() => expect(addHistory).toHaveBeenCalledTimes(1));
    expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({
      callKind: "clientStreaming",
      outcome: "timeout",
      sentCount: 2,
      receivedCount: 1,
      grpcStatus: { code: 4, name: "DEADLINE_EXCEEDED" },
    }));
    expect(JSON.stringify(addHistory.mock.calls)).not.toContain("secret detail");
  });

  it("releases a driver after closing the panel while connect is pending", async () => {
    const { streamMethod, streamService } = selectClientStream();
    let finishConnect!: (error: string) => void;
    const driver = {
      connect: vi.fn().mockReturnValue(new Promise<string>((resolve) => { finishConnect = resolve; })),
      openProtoJsonStream: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(""),
    };
    vi.mocked(createDriver).mockResolvedValue(driver as any);
    const starting = startClientStream(streamMethod, streamService);
    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalledTimes(1));
    currentPanel().onDidDispose.mock.calls[0][0]();
    finishConnect("");
    await starting;
    expect(driver.openProtoJsonStream).not.toHaveBeenCalled();
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    expect(removeDriver).toHaveBeenCalledWith(driver);
  });

  it("keeps the RPC result and reports a disconnect error", async () => {
    const { streamMethod, streamService } = selectClientStream();
    const session = {
      kind: "clientStreaming",
      events: { async *[Symbol.asyncIterator]() { /* No messages. */ } },
      completion: Promise.resolve({
        outcome: "success",
        status: { code: 0, name: "OK", details: "" },
        elapsedMs: 5,
        sentCount: 0,
        receivedCount: 1,
      }),
      cancel: vi.fn(),
    };
    const driver = {
      connect: vi.fn().mockResolvedValue(""),
      openProtoJsonStream: vi.fn().mockReturnValue(session),
      disconnect: vi.fn().mockRejectedValue(new Error("disconnect failed")),
    };
    vi.mocked(createDriver).mockResolvedValue(driver as any);
    await startClientStream(streamMethod, streamService);
    await vi.waitFor(() => expect(messages().some((message) => message.command === "streamCompleted")).toBe(true));
    expect(messages().find((message) => message.command === "streamCompleted")).toMatchObject({
      value: { streamCompleted: { completion: {
        outcome: "success", status: { code: 0 }, cleanupError: "disconnect failed",
      } } },
    });
    expect(messages().find((message) => message.command === "streamError")).toMatchObject({
      value: { streamError: { error: "disconnect failed" } },
    });
    expect(removeDriver).toHaveBeenCalledWith(driver);
  });
});
