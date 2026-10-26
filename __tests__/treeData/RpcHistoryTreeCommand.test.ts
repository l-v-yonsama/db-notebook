import {
  DBType, DbConnection, RpcDatabase, RpcMethod, RpcPackage, RpcService,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_RPC_HISTORY_IN_INVOKE_PANEL, LOAD_DB_SCHEMA } from "../../src/constant";
import { RpcInvokePanel } from "../../src/panels/RpcInvokePanel";
import { registerRpcHistoryTreeCommands } from "../../src/treeData/history/RpcHistoryTreeCommand";
import { RpcHistoryTreeProvider } from "../../src/treeData/history/RpcHistoryTreeProvider";
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
  invokedAt: 1,
  totalElapsedMs: 4,
  sentCount: 1,
  receivedCount: 1,
  outcome: "success",
  requestJson: '{"id":"saved"}',
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
      context, store, { refresh: vi.fn() } as unknown as RpcHistoryTreeProvider, storage, tree
    );
    const open = vi.mocked(commands.registerCommand).mock.calls.find(
      ([command]) => command === OPEN_RPC_HISTORY_IN_INVOKE_PANEL
    )![1] as (history: RpcInvokeHistory) => Promise<void>;
    await open(history);
    expect(commands.executeCommand).toHaveBeenCalledWith(LOAD_DB_SCHEMA, connection);
    expect(render).toHaveBeenCalledWith(
      context.extensionUri, storage, tree, method, service, "rpc", history.requestJson
    );

    render.mockClear();
    await open({ ...history, id: "not-saved", requestJson: "{}" });
    expect(render).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
