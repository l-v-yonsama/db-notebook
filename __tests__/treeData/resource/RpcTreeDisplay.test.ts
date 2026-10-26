import {
  DBType,
  DbConnection,
  RpcDatabase,
  RpcField,
  RpcMessage,
  RpcMethod,
  RpcPackage,
  RpcService,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { GeneralColumnType } from "@l-v-yonsama/rdh";
import { ThemeIcon, TreeItemCollapsibleState, type ExtensionContext } from "vscode";
import { describe, expect, it, vi } from "vitest";
import { ResourceTreeProvider } from "../../../src/treeData/resource/ResourceTreeProvider";
import type { StateStorage } from "../../../src/utilities/StateStorage";

describe("RPC message tree and field properties", () => {
  it("shows streaming methods as invokable resources", () => {
    vi.spyOn(ResourceTreeProvider.prototype, "init").mockImplementation(() => {});
    const provider = new ResourceTreeProvider({} as ExtensionContext, {} as StateStorage);
    const method = new RpcMethod(
      "BidiStream", "/example.TestService/BidiStream", "example.Request", "example.Reply", true, true
    );

    const item = provider.getTreeItem(method);
    expect(item.description).toBe("streaming");
    expect(item.tooltip).toBe("/example.TestService/BidiStream\nexample.Request → example.Reply");
    expect(item.contextValue).toMatch(/^RpcMethod,/);
    vi.restoreAllMocks();
  });

  it("expands one referenced Message level under request fields and marks deprecated fields", async () => {
    vi.spyOn(ResourceTreeProvider.prototype, "init").mockImplementation(() => {});
    const connection = new DbConnection({ name: "rpc", dbType: DBType.RPC });
    const database = new RpcDatabase("localhost");
    const pkg = database.addChild(new RpcPackage("example"));
    const service = pkg.addChild(new RpcService("TestService", "example.TestService"));
    const method = service.addChild(
      new RpcMethod("Create", "/example.TestService/Create", "example.Request", "example.Reply")
    );
    const request = method.addChild(new RpcMessage("Request", "example.Request", "request"));
    const reference = request.addChild(
      new RpcField(
        "test_table", 1, { kind: "message", typeName: "example.TestTable" },
        GeneralColumnType.OBJECT, "explicit"
      )
    );
    const table = new RpcMessage("TestTable", "example.TestTable");
    table.addChild(new RpcField(
      "deprecated_string_value", 21, { kind: "scalar", scalar: "string" },
      GeneralColumnType.TEXT, "implicit", undefined, "deprecatedStringValue", { deprecated: true }
    ));
    table.addChild(new RpcField(
      "self", 22, { kind: "message", typeName: "example.TestTable" },
      GeneralColumnType.OBJECT, "explicit"
    ));
    database.messageDefinitions = [table];
    database.expandMessageReferences();
    const storage = {
      getResourceByName: () => [database],
    } as unknown as StateStorage;
    const provider = new ResourceTreeProvider({} as ExtensionContext, storage);
    await provider.getChildren(connection);
    await provider.getChildren(database);
    await provider.getChildren(pkg);
    await provider.getChildren(service);
    await provider.getChildren(method);
    await provider.getChildren(request);

    expect(provider.getTreeItem(reference).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    const nested = (await provider.getChildren(reference)) as RpcField[];
    expect(nested.map((field) => field.name)).toEqual(["deprecated_string_value", "self"]);
    expect(provider.getParent(nested[0])).toBe(reference);
    expect(provider.getTreeItem(nested[1]).collapsibleState).toBe(TreeItemCollapsibleState.None);
    expect(await provider.getChildren(nested[1])).toEqual([]);
    expect(await provider.getChildren(reference)).toBe(nested);

    const deprecatedItem = provider.getTreeItem(nested[0]);
    expect(deprecatedItem.description).toContain("deprecated");
    expect((deprecatedItem.iconPath as ThemeIcon).color?.id).toBe("disabledForeground");
    expect(nested[0].getProperties()).toMatchObject({
      name: "deprecated_string_value",
      fieldNumber: 21,
      type: "string",
      jsonName: "deprecatedStringValue",
      presence: "implicit",
      deprecated: true,
      proto3Optional: false,
      required: false,
    });
    expect(request.getProperties()).toMatchObject({
      name: "Request", fullName: "example.Request", direction: "request",
    });
    provider.forgetResourceTree([database]);
    expect(provider.getParent(nested[0])).toBeUndefined();
    vi.restoreAllMocks();
  });
});
