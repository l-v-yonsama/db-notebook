import {
  DBType, DbConnection, RpcDatabase, RpcMethod, RpcPackage, RpcService,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREATE_NEW_NOTEBOOK, EXECUTE_RPC_HISTORY, OPEN_RPC_HISTORY_AS_NOTEBOOK,
  OPEN_RPC_HISTORY_IN_INVOKE_PANEL, LOAD_DB_SCHEMA,
} from "../../src/constant";
import { RpcInvokePanel } from "../../src/panels/RpcInvokePanel";
import { registerRpcHistoryTreeCommands } from "../../src/treeData/history/RpcHistoryTreeCommand";
import { HistoryTreeProvider } from "../../src/treeData/history/HistoryTreeProvider";
import type { ResourceTreeProvider } from "../../src/treeData/resource/ResourceTreeProvider";
import type { RpcInvokeHistory } from "../../src/types/RpcInvokeHistory";
import type { RpcInvokeHistoryStore } from "../../src/utilities/RpcInvokeHistoryStore";
import type { StateStorage } from "../../src/utilities/StateStorage";

const history: RpcInvokeHistory = {
  id: "history-1",
  connectionName: "rpc",
  service: "fixture.v1.Service",
  method: "Call",
  path: "/fixture.v1.Service/Call",
  callKind: "unary",
  executedAt: 1,
  executionCount: 1,
  requestDigest: "digest",
  totalElapsedMs: 4,
  sentCount: 1,
  receivedCount: 1,
  outcome: "success",
  requestJson: '{"id":"saved"}',
  requestMetadata: { "x-trace-id": "saved" },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Open RPC history in Invoke RPC", () => {
  it("loads a missing schema, resolves the current method, and restores JSON without invoking", async () => {
    const connection = new DbConnection({ name: "rpc", dbType: DBType.RPC });
    const database = new RpcDatabase("fixture");
    const pkg = new RpcPackage("fixture.v1");
    const service = new RpcService("Service", "fixture.v1.Service");
    const method = new RpcMethod("Call", history.path, "fixture.v1.Request", "fixture.v1.Response");
    database.addChild(pkg);
    pkg.addChild(service);
    service.addChild(method);
    let loaded = false;
    const tree = {
      getChildren: vi.fn(async (parent?: object) => {
        if (!parent) {
          return [connection];
        }
        if (parent === connection) {
          return loaded ? [database] : [];
        }
        return (parent as RpcDatabase).children;
      }),
      getLoadedRpcMethodContext: vi.fn(() => ({ connection, service, database })),
    } as unknown as ResourceTreeProvider;
    const storage = {
      getResourceByName: vi.fn(() => loaded ? [database] : undefined),
    } as unknown as StateStorage;
    const store = { list: vi.fn(async () => [history]) } as unknown as RpcInvokeHistoryStore;
    const context = { subscriptions: [], extensionUri: Uri.file("/extension") } as unknown as ExtensionContext;
    const render = vi.spyOn(RpcInvokePanel, "render").mockImplementation(() => undefined);
    vi.mocked(commands.executeCommand).mockImplementation(async (command) => {
      if (command === LOAD_DB_SCHEMA) {
        loaded = true;
      }
      return undefined;
    });
    registerRpcHistoryTreeCommands(
      context, store, { refresh: vi.fn() } as unknown as HistoryTreeProvider, storage, tree
    );
    const open = vi.mocked(commands.registerCommand).mock.calls.find(
      ([command]) => command === OPEN_RPC_HISTORY_IN_INVOKE_PANEL
    )![1] as (history: RpcInvokeHistory) => Promise<void>;
    await open(history);
    expect(commands.executeCommand).toHaveBeenCalledWith(LOAD_DB_SCHEMA, connection);
    expect(render).toHaveBeenCalledWith(
      context.extensionUri, storage, tree, method, service, "rpc", {
        requestJson: history.requestJson,
        requestMetadata: history.requestMetadata,
        autoInvoke: false,
      }
    );

    const execute = vi.mocked(commands.registerCommand).mock.calls.find(
      ([command]) => command === EXECUTE_RPC_HISTORY
    )![1] as (history: RpcInvokeHistory) => Promise<void>;
    await execute(history);
    expect(render).toHaveBeenLastCalledWith(
      context.extensionUri, storage, tree, method, service, "rpc", {
        requestJson: history.requestJson,
        requestMetadata: history.requestMetadata,
        autoInvoke: true,
      }
    );

    render.mockClear();
    await open({ ...history, id: "not-saved", requestJson: "{}" });
    expect(render).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("creates an RPC cell with the saved request and metadata", async () => {
    const store = { list: vi.fn(async () => [history]) } as unknown as RpcInvokeHistoryStore;
    const context = { subscriptions: [], extensionUri: Uri.file("/extension") } as unknown as ExtensionContext;
    registerRpcHistoryTreeCommands(
      context, store, { refresh: vi.fn() } as unknown as HistoryTreeProvider,
      {} as StateStorage, {} as ResourceTreeProvider
    );
    const open = vi.mocked(commands.registerCommand).mock.calls.find(
      ([command]) => command === OPEN_RPC_HISTORY_AS_NOTEBOOK
    )![1] as (history: RpcInvokeHistory) => Promise<void>;
    await open(history);
    const cells = vi.mocked(commands.executeCommand).mock.calls.find(
      ([command]) => command === CREATE_NEW_NOTEBOOK
    )![1] as Array<{ value: string; languageId: string; metadata?: any }>;
    expect(cells[1]).toMatchObject({
      value: history.requestJson,
      languageId: "rpc-json",
      metadata: {
        connectionName: "rpc",
        rpc: { metadataJson: '{\n  "x-trace-id": "saved"\n}' },
      },
    });

    vi.mocked(commands.executeCommand).mockClear();
    await open({ ...history, callKind: "bidiStreaming", requestJson: '[{"id":1},{"id":2}]' });
    const streamingCells = vi.mocked(commands.executeCommand).mock.calls.find(
      ([command]) => command === CREATE_NEW_NOTEBOOK
    )![1] as Array<{ value: string }>;
    expect(streamingCells[1].value).toBe('[{"id":1},{"id":2}]');

    vi.mocked(commands.executeCommand).mockClear();
    await open({ ...history, requestJson: undefined });
    expect(commands.executeCommand).not.toHaveBeenCalledWith(CREATE_NEW_NOTEBOOK, expect.anything());
  });
});
