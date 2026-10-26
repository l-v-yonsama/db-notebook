import { DBType, type ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import type { ExtensionContext, SecretStorage } from "vscode";
import { describe, expect, it } from "vitest";
import { StateStorage, STORAGE_KEY } from "../../src/utilities/StateStorage";

function createStorage() {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const context = {
    globalState: {
      get: <T>(key: string, fallback?: T): T =>
        (values.has(key) ? values.get(key) : fallback) as T,
      update: async (key: string, value: unknown) => { values.set(key, value); },
    },
  } as unknown as ExtensionContext;
  const secretStorage = {
    get: async (key: string) => secrets.get(key),
    store: async (key: string, value: string) => { secrets.set(key, value); },
    delete: async (key: string) => { secrets.delete(key); },
  } as SecretStorage;
  return { storage: new StateStorage(context, secretStorage), values, secrets };
}

const rpcSetting = (name: string, token: string): ConnectionSetting => ({
  id: name,
  name,
  dbType: DBType.RPC,
  host: "localhost",
  port: 50051,
  ssl: { use: true },
  rpc: {
    protoFilePath: "/project/service.proto",
    discovery: "verify",
    authentication: { type: "bearer", token },
  },
});

describe("RPC connection secrets", () => {
  it("retains the response default-value setting on the connection", async () => {
    const { storage } = createStorage();
    const setting = rpcSetting("defaults", "token");
    setting.rpc!.showDefaultValues = true;
    await storage.addConnectionSetting(setting);
    expect((await storage.getConnectionSettingByName("defaults"))?.rpc?.showDefaultValues)
      .toBe(true);
    expect(storage.getPasswordlessConnectionSettingByName("defaults")?.rpc?.showDefaultValues)
      .toBe(true);
  });

  it("stores Bearer tokens only in SecretStorage, including when another connection is saved", async () => {
    const { storage, values, secrets } = createStorage();
    await storage.addConnectionSetting(rpcSetting("first", "first-token"));
    expect(secrets.get("first+rpcToken")).toBe("first-token");
    expect(JSON.stringify(values.get(STORAGE_KEY))).not.toContain("first-token");

    const first = await storage.getConnectionSettingByName("first");
    expect(first?.rpc?.authentication).toEqual({ type: "bearer", token: "first-token" });
    first!.rpc!.protoFilePath = "changed";
    expect(storage.getPasswordlessConnectionSettingByName("first")?.rpc?.protoFilePath)
      .toBe("/project/service.proto");

    await storage.addConnectionSetting(rpcSetting("second", "second-token"));
    expect(JSON.stringify(values.get(STORAGE_KEY))).not.toContain("first-token");
    expect(JSON.stringify(values.get(STORAGE_KEY))).not.toContain("second-token");
    expect((await storage.getConnectionSettingList()).map((setting) =>
      setting.rpc?.authentication?.type === "bearer" ? setting.rpc.authentication.token : ""
    )).toEqual(["first-token", "second-token"]);

    const duplicate = (await storage.getConnectionSettingByName("first"))!;
    duplicate.name = "copy";
    duplicate.id = undefined;
    await storage.addConnectionSetting(duplicate);
    expect(duplicate.id).not.toBe("first");
    expect(secrets.get(`${duplicate.id}+rpcToken`)).toBe("first-token");
    expect(JSON.stringify(values.get(STORAGE_KEY))).not.toContain("first-token");
  });

  it("retains an unchanged token, clears it when authentication is removed, and deletes it with the connection", async () => {
    const { storage, secrets } = createStorage();
    await storage.addConnectionSetting(rpcSetting("rpc", "initial-token"));
    await storage.editConnectionSetting(rpcSetting("rpc", ""));
    expect(secrets.get("rpc+rpcToken")).toBe("initial-token");

    const noAuth: ConnectionSetting = {
      ...rpcSetting("rpc", ""),
      ssl: { use: false },
      rpc: { protoFilePath: "/project/service.proto", authentication: { type: "none" } },
    };
    await storage.editConnectionSetting(noAuth);
    expect(secrets.has("rpc+rpcToken")).toBe(false);

    await storage.editConnectionSetting(rpcSetting("rpc", "next-token"));
    await storage.deleteConnectionSetting("rpc");
    expect(secrets.has("rpc+rpcToken")).toBe(false);
  });
});
