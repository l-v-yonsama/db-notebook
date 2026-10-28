import { beforeEach, describe, expect, it, vi } from "vitest";
import { window } from "vscode";
import { DBType, RpcDatabase, RpcMethod, RpcPackage, RpcService } from "@l-v-yonsama/multi-platform-database-drivers";
import { runRpcText, RunRpcToolInput } from "../../../src/aiTools/lmTools/RunRpcTool";
import { workflow } from "../../../src/utilities/driverResolver";
import type { StateStorage } from "../../../src/utilities/StateStorage";
import type { RpcInvokeHistoryStore } from "../../../src/utilities/RpcInvokeHistoryStore";

vi.mock("../../../src/utilities/driverResolver", () => ({ workflow: vi.fn() }));

const input: RunRpcToolInput = {
  connectionName: "Rpc",
  serviceName: "example.v1.Greeter",
  methodName: "Hello",
  requestJson: '{"name":"Ada"}',
};

function fixture() {
  const db = new RpcDatabase("localhost:50051");
  const pkg = new RpcPackage("example.v1");
  const service = new RpcService("Greeter", "example.v1.Greeter");
  service.addChild(new RpcMethod("Hello", "/example.v1.Greeter/Hello", "example.v1.HelloRequest", "example.v1.HelloReply"));
  pkg.addChild(service);
  db.addChild(pkg);
  const setting = { name: "Rpc", dbType: DBType.RPC };
  const stateStorage = {
    getConnectionSettingByName: vi.fn(async () => setting),
    getConnectionSettingNames: vi.fn(() => ["Rpc"]),
    isMcpEnabledForConnection: vi.fn(() => true),
    getDBTypeByConnectionName: vi.fn(() => DBType.RPC),
    loadResource: vi.fn(async () => ({ ok: true, result: { db: [db], dbType: DBType.RPC } })),
    getAiMaskingLevelForConnection: vi.fn(() => 0),
  } as unknown as StateStorage;
  const add = vi.fn(async () => undefined);
  const historyStore = { add } as unknown as RpcInvokeHistoryStore;
  return { stateStorage, historyStore, add };
}

describe("runRpcText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("MCP confirmation cancelled: sends nothing and records no history", async () => {
    const { stateStorage, historyStore, add } = fixture();
    vi.mocked(window.showWarningMessage).mockResolvedValue(undefined);
    const text = await runRpcText(stateStorage, historyStore, input, { source: "mcp" });
    expect(text).toContain("cancelled before sending");
    expect(workflow).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("confirmed unary call records request and returns the response", async () => {
    const { stateStorage, historyStore, add } = fixture();
    vi.mocked(window.showWarningMessage).mockResolvedValue("Invoke RPC");
    vi.mocked(workflow).mockImplementation(async (_setting, run) => ({
      ok: true,
      result: await run({
        invokeUnaryProtoJson: async () => ({
          contents: { greeting: "Hello Ada" }, status: { code: 0, name: "OK", details: "" }, elapsedMs: 12,
        }),
      } as any),
    } as any));
    const text = await runRpcText(stateStorage, historyStore, input, { source: "mcp" });
    expect(JSON.parse(text).data).toEqual({ greeting: "Hello Ada" });
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0][0]).toMatchObject({ path: "/example.v1.Greeter/Hello", callKind: "unary", outcome: "success", sentCount: 1, receivedCount: 1 });
  });
});
