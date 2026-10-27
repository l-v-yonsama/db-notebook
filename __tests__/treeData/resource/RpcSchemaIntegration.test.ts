import {
  DBType,
  DbConnection,
  RpcDatabase,
  RpcField,
  RpcMessage,
  RpcMethod,
  RpcPackage,
  RpcService,
  RPCDriver,
  buildRpcRequestTemplate,
  type UnaryResult,
  type ConnectionSetting,
} from "@l-v-yonsama/multi-platform-database-drivers";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Uri, window, TreeItemCollapsibleState, type ExtensionContext, type SecretStorage } from "vscode";
import { describe, expect, it, vi } from "vitest";
import { ResourceTreeProvider } from "../../../src/treeData/resource/ResourceTreeProvider";
import { RpcInvokePanel } from "../../../src/panels/RpcInvokePanel";
import { StateStorage } from "../../../src/utilities/StateStorage";
import { workflow } from "../../../src/utilities/driverResolver";

const driversRoot = path.resolve(__dirname, "../../../../db-drivers");
const fixtureProto = path.join(driversRoot, "docker/rpc-test/fixture.proto");
const includeDir = path.join(driversRoot, "docker/rpc-test/includes");
const caFilePath = path.join(driversRoot, "docker/rpc-test/certs/server.crt");

function createStorage(): { storage: StateStorage; context: ExtensionContext } {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const context = {
    globalState: {
      get: <T>(key: string, fallback?: T): T => (values.has(key) ? values.get(key) : fallback) as T,
      update: async (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
  } as unknown as ExtensionContext;
  const secretStorage = {
    get: async (key: string) => secrets.get(key),
    store: async (key: string, value: string) => {
      secrets.set(key, value);
    },
    delete: async (key: string) => {
      secrets.delete(key);
    },
  } as SecretStorage;
  return { storage: new StateStorage(context, secretStorage), context };
}

const plaintext = (protoFilePath = fixtureProto): ConnectionSetting => ({
  name: "rpc-tree-test",
  dbType: DBType.RPC,
  host: "127.0.0.1",
  port: 65051,
  connectTimeoutMs: 2000,
  queryTimeoutMs: 2000,
  rpc: {
    protoFilePath,
    includeDirs: [includeDir],
    discovery: "verify",
    authentication: { type: "none" },
  },
});

describe.skipIf(process.env.RPC_TEST_INTEGRATION !== "1")("RPC schema tree (Docker)", () => {
  it("renders verified services, methods, messages, and fields; reloads in proto mode", async () => {
    const { storage, context } = createStorage();
    await storage.addConnectionSetting(plaintext());
    const verified = await storage.loadResource("rpc-tree-test", true, true);
    expect(verified.ok).toBe(true);
    const provider = new ResourceTreeProvider(context, storage);
    const connection = new DbConnection(
      (await storage.getConnectionSettingByName("rpc-tree-test"))!
    );
    expect(provider.getTreeItem(connection).contextValue).toContain("sqlNotebook:false");
    const [database] = (await provider.getChildren(connection)) as RpcDatabase[];
    expect(database).toBeInstanceOf(RpcDatabase);
    const pkg = ((await provider.getChildren(database)) as RpcPackage[]).find(
      (child) => child.name === "rpcfixture.v1"
    )!;
    const service = pkg.children.find((child) => child.name === "CustomerService") as RpcService;
    const message = database.messageDefinitions.find(
      (child) => child.name === "TestTable"
    ) as RpcMessage;
    const streaming = pkg.children.find(
      (child) => child.name === "StreamingTestService"
    ) as RpcService;
    await provider.getChildren(pkg);
    await provider.getChildren(service);
    await provider.getChildren(streaming);
    expect(service.discovery).toBe("advertised");
    expect(provider.getTreeItem(service).description).toBe("advertised");
    expect(pkg.children.every((child) => child instanceof RpcService)).toBe(true);
    expect(database.children.find((child) => child.name === "google.protobuf")).toBeUndefined();
    expect(
      database.messageDefinitions.find((child) => child.fullName === "google.protobuf.Timestamp")
    ).toBeInstanceOf(RpcMessage);
    const method = service.children.find((child) => child.name === "GetCustomer") as RpcMethod;
    await provider.getChildren(method);
    expect(method.children.map((child) => child.direction)).toEqual(["request", "response"]);
    expect(method.children.map((child) => child.name)).toEqual(["GetCustomerRequest", "Customer"]);
    expect(provider.getTreeItem(method.children[0]).description).toBe("request");
    const methodItem = provider.getTreeItem(method);
    expect(methodItem.description).toBe("unary");
    expect(methodItem.command).toBeUndefined();
    expect(methodItem.contextValue).toMatch(/^RpcMethod,/);
    expect(provider.getLoadedRpcMethodContext(method)?.service).toBe(service);
    const streamMethod = streaming.children.find(
      (child) => child.name === "BidiStream"
    ) as RpcMethod;
    const streamItem = provider.getTreeItem(streamMethod);
    expect(streamItem.description).toBe("streaming");
    expect(streamItem.contextValue).toMatch(/^RpcMethod,/);
    expect(streamItem.command).toBeUndefined();
    const field = message.children.find(
      (child) => child.name === "int64_values_by_key"
    ) as RpcField;
    expect(provider.getTreeItem(field).description).toContain("map<int32, int64>");
    const timestamp = message.children.find(
      (child) => child.name === "timestamp_value"
    ) as RpcField;
    expect(provider.getTreeItem(timestamp).description).toContain("google.protobuf.Timestamp");
    const testTableService = pkg.children.find(
      (child) => child.name === "TestTableService"
    ) as RpcService;
    const createTestTable = testTableService.children.find(
      (child) => child.name === "CreateTestTable"
    ) as RpcMethod;
    await provider.getChildren(testTableService);
    await provider.getChildren(createTestTable);
    const createRequest = createTestTable.children.find(
      (child) => child.direction === "request"
    ) as RpcMessage;
    await provider.getChildren(createRequest);
    const testTableReference = createRequest.children[0];
    expect(provider.getTreeItem(testTableReference).collapsibleState).toBe(
      TreeItemCollapsibleState.Collapsed
    );
    const referencedFields = (await provider.getChildren(testTableReference)) as RpcField[];
    expect(referencedFields).toHaveLength(24);
    const deprecatedField = referencedFields.find(
      (child) => child.name === "deprecated_string_value"
    )!;
    expect(provider.getTreeItem(deprecatedField).description).toContain("deprecated");
    expect(deprecatedField.getProperties()).toMatchObject({
      fieldNumber: 21,
      type: "string",
      deprecated: true,
    });
    const requestView = buildRpcRequestTemplate(createTestTable, database.messageDefinitions);
    const sample = JSON.parse(requestView.data);
    expect(sample.testTable.int64Value).toBe("0");
    expect(sample.testTable.boolValue).toBe(false);
    expect(sample.testTable.stringValue).toBe("");
    expect(sample.testTable.int32Values).toEqual([]);
    expect(sample.testTable.stringValuesByKey).toEqual({});
    expect(sample.testTable.timestampValue).toBe("1970-01-01T00:00:00Z");
    expect(requestView.description).toContain("message CreateTestTableRequest");
    expect(requestView.description).toContain("message TestTable");
    expect(requestView.description).toContain("message Timestamp");
    expect(requestView.description).toContain("enum SampleState");

    const setting = (await storage.getConnectionSettingByName("rpc-tree-test"))!;
    setting.rpc!.discovery = "proto";
    await storage.editConnectionSetting(setting);
    const declared = await storage.loadResource("rpc-tree-test", true, true);
    expect(declared.ok).toBe(true);
    expect(provider.getLoadedRpcMethodContext(method)).toBeUndefined();
    const declaredPackage = declared.result!.db[0].children.find(
      (child) => child.name === "rpcfixture.v1"
    ) as RpcPackage;
    expect(
      (declaredPackage.children.find((child) => child.name === "CustomerService") as RpcService)
        .discovery
    ).toBe("declared");
  });

  it("invokes a loaded unary method and displays response metadata and errors", async () => {
    const { storage, context } = createStorage();
    await storage.addConnectionSetting(plaintext());
    expect((await storage.loadResource("rpc-tree-test", true, true)).ok).toBe(true);
    const provider = new ResourceTreeProvider(context, storage);
    const connection = new DbConnection(
      (await storage.getConnectionSettingByName("rpc-tree-test"))!
    );
    const [database] = (await provider.getChildren(connection)) as RpcDatabase[];
    const pkg = ((await provider.getChildren(database)) as RpcPackage[]).find(
      (child) => child.name === "rpcfixture.v1"
    )!;
    await provider.getChildren(pkg);
    const service = pkg.children.find((child) => child.name === "CustomerService") as RpcService;
    await provider.getChildren(service);
    const method = service.children.find((child) => child.name === "GetCustomer") as RpcMethod;
    RpcInvokePanel.render(
      Uri.file("/extension"),
      storage,
      provider,
      method,
      service,
      connection.name
    );
    const panel = vi.mocked(window.createWebviewPanel).mock.results.at(-1)!.value;
    const initialTarget = panel.webview.postMessage.mock.calls
      .map((call: unknown[]) => call[0])
      .find((message: { command: string }) => message.command === "initialize")?.value.initialize;
    expect(JSON.parse(initialTarget.requestTemplate)).toEqual({ id: "0" });
    expect(initialTarget.requestDescription).toContain("message GetCustomerRequest");
    expect(initialTarget.responseDescription).toContain("message Customer");
    const send = async (request: unknown) =>
      panel.webview.onDidReceiveMessage.mock.calls[0][0](request);
    const posted = () => panel.webview.postMessage.mock.calls.map((call: unknown[]) => call[0]);
    try {
      await send({
        command: "invokeRpc",
        params: {
          connectionName: connection.name,
          service: service.fullName,
          method: method.name,
          requestJson: '{"id":"-1"}',
        },
      });
      expect(posted().at(-1)).toMatchObject({
        command: "error",
        value: { error: expect.stringMatching(/ statusCode:5$/) },
      });

      const created = await workflow<RPCDriver, UnaryResult>(
        (await storage.getConnectionSettingByName(connection.name))!,
        (driver) =>
          driver.invokeUnary({
            service: service.fullName,
            method: "CreateCustomer",
            request: { name: "Panel test" },
          }),
        false
      );
      expect(created.ok).toBe(true);
      await send({
        command: "invokeRpc",
        params: {
          connectionName: connection.name,
          service: service.fullName,
          method: method.name,
          requestJson: JSON.stringify({ id: created.result!.contents.id }),
        },
      });
      const result = posted().at(-1);
      expect(result.command).toBe("result");
      expect(result.value.result.status).toMatchObject({ code: 0, name: "OK" });
      expect(result.value.result.contentsHtml).toContain("Panel test");
      expect(result.value.result.headersHtml).toContain("x-rpc-tag");
      expect(result.value.result.trailersHtml).toContain("x-rpc-trailer");
    } finally {
      panel.onDidDispose.mock.calls[0][0]();
    }
  });

  it("loads the tree and invokes a method using reflection without local proto paths", async () => {
    const { storage, context } = createStorage();
    const setting = plaintext();
    setting.rpc = { discovery: "reflection", authentication: { type: "none" } };
    await storage.addConnectionSetting(setting);
    const loaded = await storage.loadResource(setting.name, true, true);
    expect(loaded.ok).toBe(true);
    const provider = new ResourceTreeProvider(context, storage);
    const connection = new DbConnection((await storage.getConnectionSettingByName(setting.name))!);
    const [database] = (await provider.getChildren(connection)) as RpcDatabase[];
    const pkg = ((await provider.getChildren(database)) as RpcPackage[]).find(
      (child) => child.name === "rpcfixture.v1"
    )!;
    await provider.getChildren(pkg);
    const service = pkg.children.find((child) => child.name === "CustomerService") as RpcService;
    await provider.getChildren(service);
    expect(service.discovery).toBe("advertised");
    expect(database.messageDefinitions.find((child) => child.name === "Customer")).toBeInstanceOf(
      RpcMessage
    );
    const method = service.children.find((child) => child.name === "ListCustomers") as RpcMethod;
    expect(provider.getTreeItem(method).command).toBeUndefined();
    expect(provider.getTreeItem(method).contextValue).toMatch(/^RpcMethod,/);
    const result = await workflow<RPCDriver, UnaryResult>(
      (await storage.getConnectionSettingByName(setting.name))!,
      (driver) =>
        driver.invokeUnary({ service: service.fullName, method: method.name, request: {} }),
      false
    );
    expect(result.ok).toBe(true);
    expect(result.result?.status).toMatchObject({ code: 0, name: "OK" });
    expect(
      (await storage.getConnectionSettingByName(setting.name))?.rpc?.protoFilePath
    ).toBeUndefined();
  });

  it("reports missing reflection and allows an explicit proto fallback", async () => {
    const { storage } = createStorage();
    await storage.addConnectionSetting({
      ...plaintext(),
      host: "localhost",
      port: 65052,
      ssl: { use: true },
      rpc: {
        protoFilePath: fixtureProto,
        includeDirs: [includeDir],
        caFilePath,
        discovery: "verify",
        authentication: { type: "bearer", token: "rpc-fixture-token" },
      },
    });
    const unavailable = await storage.loadResource("rpc-tree-test", true, true);
    expect(unavailable.ok).toBe(false);
    expect(unavailable.message).toBeTruthy();
    expect(storage.getResourceByName("rpc-tree-test")).toBeUndefined();

    const setting = (await storage.getConnectionSettingByName("rpc-tree-test"))!;
    setting.rpc!.discovery = "proto";
    await storage.editConnectionSetting(setting);
    const fallback = await storage.loadResource("rpc-tree-test", true, true);
    expect(fallback.ok).toBe(true);
    const pkg = fallback.result!.db[0].children.find(
      (child) => child.name === "rpcfixture.v1"
    ) as RpcPackage;
    expect(
      (pkg.children.find((child) => child.name === "CustomerService") as RpcService).discovery
    ).toBe("declared");
  });

  it("reports a reflected method mismatch without showing stale resources", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-notebook-schema-"));
    try {
      const protoFilePath = path.join(directory, "mismatch.proto");
      fs.writeFileSync(
        protoFilePath,
        fs
          .readFileSync(fixtureProto, "utf8")
          .replace("rpc GetCustomer(GetCustomerRequest)", "rpc GetCustomer(ListCustomersRequest)")
      );
      const { storage } = createStorage();
      await storage.addConnectionSetting(plaintext());
      expect((await storage.loadResource("rpc-tree-test", true, true)).ok).toBe(true);
      const setting = (await storage.getConnectionSettingByName("rpc-tree-test"))!;
      setting.rpc!.protoFilePath = protoFilePath;
      await storage.editConnectionSetting(setting);
      const result = await storage.loadResource("rpc-tree-test", true, true);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("SCHEMA_MISMATCH");
      expect(storage.getResourceByName("rpc-tree-test")).toBeUndefined();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
