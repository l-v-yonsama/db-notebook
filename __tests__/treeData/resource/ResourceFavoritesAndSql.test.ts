import {
  AwsDatabase,
  AwsServiceType,
  DbResourceGroup,
  DbSchema,
  DbSsmParameter,
  DbTable,
  DBType,
  RdsDatabase,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands, env, window } from "vscode";
import type { ExtensionContext, SecretStorage, TreeItem, TreeView } from "vscode";
import {
  ADD_RESOURCE_FAVORITE,
  COPY_QUALIFIED_TABLE_NAME,
  CREATE_NEW_NOTEBOOK,
  OPEN_TABLE_SELECT_NOTEBOOK,
  REMOVE_RESOURCE_FAVORITE,
  SHOW_RESOURCE_FAVORITES,
} from "../../../src/constant";
import { registerResourceTreeCommand } from "../../../src/treeData/resource/ResourceTreeCommand";
import { ResourceTreeProvider } from "../../../src/treeData/resource/ResourceTreeProvider";
import { RESOURCE_FAVORITES_KEY, StateStorage, STORAGE_KEY } from "../../../src/utilities/StateStorage";

const makeTree = () => {
  const db = new RdsDatabase("commerce");
  const schema = db.addChild(new DbSchema("public"));
  const table = schema.addChild(new DbTable("orders", "TABLE", "注文"));
  table.meta = { conName: "prod-sales", schemaName: "public", dbType: DBType.Postgres };
  return { db, schema, table };
};

const makeGroupedSsmTree = (groupName: string) => {
  const db = new AwsDatabase("SSM", AwsServiceType.SSM);
  const group = db.addChild(new DbResourceGroup(groupName));
  const parameter = group.addChild(new DbSsmParameter("/app/config", { type: "String" }));
  return { db, parameter };
};

const handlerFor = (command: string): ((...args: unknown[]) => Promise<unknown>) => {
  const call = vi.mocked(commands.registerCommand).mock.calls.find(([name]) => name === command);
  if (!call) {
    throw new Error(`Command not registered: ${command}`);
  }
  return call[1] as (...args: unknown[]) => Promise<unknown>;
};

const setup = async (withId = true) => {
  vi.spyOn(ResourceTreeProvider.prototype, "init").mockImplementation(() => {});
  const values = new Map<string, unknown>();
  values.set(STORAGE_KEY, [
    { name: "prod-sales", dbType: DBType.Postgres, ...(withId ? { id: "stable-prod-id" } : {}) },
  ]);
  const context = {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T): T =>
        (values.has(key) ? values.get(key) : defaultValue) as T,
      update: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    },
  } as unknown as ExtensionContext;
  const secrets = {
    get: vi.fn(async () => undefined),
    store: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  } as unknown as SecretStorage;
  const storage = new StateStorage(context, secrets);
  const initial = makeTree();
  storage.resetResource("prod-sales", [initial.db]);
  const provider = new ResourceTreeProvider(context, storage);
  await provider.refresh(true);
  const reveal = vi.fn(async () => undefined);
  registerResourceTreeCommand({
    context,
    stateStorage: storage,
    dbResourceTree: provider,
    dbResourceTreeView: { reveal, selection: [] } as unknown as TreeView<TreeItem>,
    connectionSettingViewProvider: {} as never,
  });
  const loadResource = vi.spyOn(storage, "loadResource");
  return { values, context, storage, provider, reveal, initial, loadResource };
};

describe("DB Explorer favorites and table SQL shortcuts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("persists a logical path, reveals a new resource instance after reload, and removes only the favorite", async () => {
    const { storage, provider, reveal, initial, values, loadResource } = await setup();
    provider.getLoadedResourceMatches();
    expect(provider.getTreeItem(initial.table).contextValue).toContain("favorite:false");

    await handlerFor(ADD_RESOURCE_FAVORITE)(initial.table);
    expect(storage.getResourceFavorites()).toEqual([{
      connectionId: "stable-prod-id",
      connectionName: "prod-sales",
      path: [
        { type: "RdsDatabase", name: "commerce" },
        { type: "Schema", name: "public" },
        { type: "Table", name: "orders" },
      ],
    }]);
    expect(provider.getTreeItem(initial.table).contextValue).toContain("favorite:true");
    expect(values.has(RESOURCE_FAVORITES_KEY)).toBe(true);

    const replacement = makeTree();
    storage.resetResource("prod-sales", [replacement.db]);
    await provider.refresh(true);
    vi.mocked(window.showQuickPick).mockImplementationOnce(async (items: unknown) => (items as any[])[0]);
    await handlerFor(SHOW_RESOURCE_FAVORITES)();
    expect(reveal).toHaveBeenCalledWith(replacement.table, { select: true, focus: true });
    expect(loadResource).not.toHaveBeenCalled();

    await handlerFor(REMOVE_RESOURCE_FAVORITE)(replacement.table);
    expect(storage.getResourceFavorites()).toEqual([]);
    expect(provider.getTreeItem(replacement.table).contextValue).toContain("favorite:false");
    expect(storage.getResourceByName("prod-sales")).toEqual([replacement.db]);
  });

  it("assigns a stable id to an older connection before saving its first favorite", async () => {
    const { storage, initial } = await setup(false);
    await handlerFor(ADD_RESOURCE_FAVORITE)(initial.table);
    const id = storage.getPasswordlessConnectionSettingByName("prod-sales")?.id;
    expect(id).toBeTruthy();
    expect(storage.getResourceFavorites()[0].connectionId).toBe(id);
  });

  it("keeps an AWS resource favorite when its display-only group changes", async () => {
    const { storage, provider, reveal, values } = await setup();
    values.set(STORAGE_KEY, [{ name: "prod-sales", dbType: DBType.Aws, id: "stable-prod-id" }]);
    const initial = makeGroupedSsmTree("String params");
    storage.resetResource("prod-sales", [initial.db]);
    await provider.refresh(true);
    provider.getLoadedResourceMatches();

    await handlerFor(ADD_RESOURCE_FAVORITE)(initial.parameter);
    expect(storage.getResourceFavorites()[0].path).toEqual([
      { type: "AwsDatabase", name: "SSM" },
      { type: "SsmParameter", name: "/app/config" },
    ]);

    const replacement = makeGroupedSsmTree("SecureString params");
    storage.resetResource("prod-sales", [replacement.db]);
    await provider.refresh(true);
    vi.mocked(window.showQuickPick).mockImplementationOnce(async (items: unknown) => (items as any[])[0]);
    await handlerFor(SHOW_RESOURCE_FAVORITES)();
    expect(reveal).toHaveBeenCalledWith(replacement.parameter, { select: true, focus: true });
    expect(provider.getTreeItem(replacement.parameter).contextValue).toContain("favorite:true");
  });

  it("keeps an unavailable favorite without selecting a same-name replacement connection", async () => {
    const { storage, provider, reveal, initial, values } = await setup();
    await handlerFor(ADD_RESOURCE_FAVORITE)(initial.table);
    values.set(STORAGE_KEY, [{ name: "prod-sales", dbType: DBType.Postgres, id: "replacement-id" }]);
    await provider.refresh(true);
    vi.mocked(window.showQuickPick).mockImplementationOnce(async (items: unknown) => (items as any[])[0]);
    await handlerFor(SHOW_RESOURCE_FAVORITES)();
    expect(reveal).not.toHaveBeenCalled();
    expect(storage.getResourceFavorites()).toHaveLength(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "This favorite's connection setting is missing."
    );
  });

  it("copies the qualified name and opens an unexecuted SELECT with the right connection", async () => {
    const { initial, loadResource } = await setup();
    await handlerFor(COPY_QUALIFIED_TABLE_NAME)(initial.table);
    expect(env.clipboard.writeText).toHaveBeenCalledWith('"public"."orders"');

    await handlerFor(OPEN_TABLE_SELECT_NOTEBOOK)(initial.table);
    const [command, cells] = vi.mocked(commands.executeCommand).mock.calls.find(
      ([name]) => name === CREATE_NEW_NOTEBOOK
    ) as [string, { value: string; metadata: { connectionName: string } }[]];
    expect(command).toBe(CREATE_NEW_NOTEBOOK);
    expect(cells).toHaveLength(1);
    expect(cells[0].value).toContain('FROM "public"."orders"');
    expect(cells[0].value).toContain("LIMIT 100");
    expect(cells[0].metadata.connectionName).toBe("prod-sales");
    expect(loadResource).not.toHaveBeenCalled();
  });
});
