import {
  DBType, DbConnection, RpcDatabase, RpcPackage, RpcService, RpcMethod, RpcMessage,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { isRpcHistorySelection } from "../../src/treeData/history/rpcHistorySelection";
import type { ResourceTreeProvider } from "../../src/treeData/resource/ResourceTreeProvider";

describe("RPC history view selection", () => {
  it("uses current gRPC connections and their loaded descendants", async () => {
    const rpc = new DbConnection({ name: "rpc", dbType: DBType.RPC });
    const sql = new DbConnection({ name: "sql", dbType: DBType.MySQL });
    const database = new RpcDatabase("fixture");
    const pkg = new RpcPackage("fixture.v1");
    const service = new RpcService("Service", "fixture.v1.Service");
    const method = new RpcMethod("Call", "/fixture.v1.Service/Call", "Req", "Res");
    const message = new RpcMessage("Req", "fixture.v1.Req", "request");
    database.addChild(pkg);
    pkg.addChild(service);
    service.addChild(method);
    method.addChild(message);
    const parents = new Map([[database, rpc], [pkg, database], [service, pkg], [method, service], [message, method]]);
    const tree = {
      getChildren: async (parent?: DbConnection) => parent === rpc ? [database] : [rpc, sql],
      getParent: async (node: object) => parents.get(node as RpcDatabase),
    } as unknown as ResourceTreeProvider;
    expect(await isRpcHistorySelection(undefined, tree)).toBe(false);
    expect(await isRpcHistorySelection(sql, tree)).toBe(false);
    expect(await isRpcHistorySelection(rpc, tree)).toBe(true);
    expect(await isRpcHistorySelection(message, tree)).toBe(true);
    const stale = new DbConnection({ name: "rpc", dbType: DBType.RPC });
    expect(await isRpcHistorySelection(stale, tree)).toBe(false);
  });
});
