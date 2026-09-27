import { DbConnection, DbSchema, DbTable, DBType, RdsDatabase } from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands, MarkdownString, TreeItemCollapsibleState, window } from "vscode";
import type { ExtensionContext, TreeItem, TreeView } from "vscode";
import { QUICK_OPEN_RESOURCE } from "../../../src/constant";
import { registerResourceTreeCommand } from "../../../src/treeData/resource/ResourceTreeCommand";
import { ConnectionListItem, ResourceTreeProvider } from "../../../src/treeData/resource/ResourceTreeProvider";
import type { StateStorage } from "../../../src/utilities/StateStorage";

const makeTableTree = (comment: string) => {
  const db = new RdsDatabase("commerce");
  const schema = db.addChild(new DbSchema("public"));
  const table = schema.addChild(new DbTable("orders", "TABLE", comment));
  return { db, schema, table };
};

const setup = async () => {
  vi.spyOn(ResourceTreeProvider.prototype, "init").mockImplementation(() => {});
  const prod = makeTableTree("注文");
  const dev = makeTableTree("取込データ");
  const trees = new Map([["prod-sales", [prod.db]], ["dev-sales", [dev.db]]]);
  const stateStorage = {
    getConnectionSettingList: vi.fn(async () => [
      { name: "prod-sales", dbType: DBType.Postgres },
      { name: "dev-sales", dbType: DBType.Postgres },
    ]),
    getResourceByName: vi.fn((name: string) => trees.get(name)),
    getDefaultConnectionName: vi.fn(() => ""),
    loadResource: vi.fn(),
  } as unknown as StateStorage;
  const provider = new ResourceTreeProvider({} as ExtensionContext, stateStorage);
  await provider.refresh(true);
  const connections = (await provider.getChildren()) as DbConnection[];
  const reveal = vi.fn(async () => undefined);
  registerResourceTreeCommand({
    context: { subscriptions: [] } as unknown as ExtensionContext,
    stateStorage,
    dbResourceTree: provider,
    dbResourceTreeView: { reveal, selection: [] } as unknown as TreeView<TreeItem>,
    connectionSettingViewProvider: {} as never,
  });
  const command = vi.mocked(commands.registerCommand).mock.calls.find(([name]) => name === QUICK_OPEN_RESOURCE)?.[1];
  if (!command) {
    throw new Error("Quick Open command was not registered");
  }
  return { provider, connections, prod, dev, reveal, command, stateStorage };
};

describe("DB Explorer connection status and Quick Open", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("shows only active filters and read-only setting in the connection item", () => {
    const connection = new DbConnection({
      name: "prod-sales",
      dbType: DBType.Postgres,
      readOnly: true,
      resourceFilter: {
        schema: { type: "include", value: "public" },
        table: { type: "prefix", value: "" },
      },
    });
    const item = new ConnectionListItem(connection, TreeItemCollapsibleState.Collapsed);
    const tooltip = item.tooltip as MarkdownString;
    expect(item.description).toContain("filtered");
    expect(tooltip.value).toContain("Schema filter (contains): public");
    expect(tooltip.value).toContain("Read-only setting: enabled");
    expect(tooltip.value).not.toContain("Table filter");

    const plain = new ConnectionListItem(
      new DbConnection({ name: "dev-sales", dbType: DBType.Postgres }),
      TreeItemCollapsibleState.Collapsed
    );
    expect(plain.description).not.toContain("filtered");
    expect((plain.tooltip as MarkdownString).value).not.toContain("Read-only setting");
  });

  it("finds loaded same-name objects without expanding the tree and resolves every ancestor", async () => {
    const { provider, connections, prod, dev, stateStorage } = await setup();
    const matches = provider.getLoadedResourceMatches();
    expect(matches.map((it) => it.path)).toEqual([
      ["prod-sales", "commerce", "public", "orders"],
      ["dev-sales", "commerce", "public", "orders"],
    ]);
    expect(matches.map((it) => it.resource.comment)).toEqual(["注文", "取込データ"]);
    expect(provider.getParent(prod.table)).toBe(prod.schema);
    expect(provider.getParent(prod.schema)).toBe(prod.db);
    expect(provider.getParent(prod.db)).toBe(connections[0]);
    expect(provider.getLoadedResourceMatches(connections[1]).map((it) => it.resource)).toEqual([dev.table]);
    expect(vi.mocked(stateStorage.loadResource)).not.toHaveBeenCalled();
  });

  it("shows connection paths and comments, then reveals the selected object", async () => {
    const { command, dev, reveal, stateStorage } = await setup();
    vi.mocked(window.showQuickPick).mockImplementationOnce(async (items: unknown) => (items as any[])[1]);
    await command();
    const [items, options] = vi.mocked(window.showQuickPick).mock.calls[0] as [any[], Record<string, unknown>];
    expect(items[0].description).toContain("prod-sales / commerce / public / orders");
    expect(items[1].detail).toBe("取込データ");
    expect(options).toMatchObject({ matchOnDescription: true, matchOnDetail: true });
    expect(reveal).toHaveBeenCalledWith(dev.table, { select: true, focus: true });
    expect(vi.mocked(stateStorage.loadResource)).not.toHaveBeenCalled();
  });

  it("limits a connection-row search to that connection", async () => {
    const { command, connections, prod, reveal } = await setup();
    vi.mocked(window.showQuickPick).mockImplementationOnce(async (items: unknown) => (items as any[])[0]);
    await command(connections[0]);
    const [items] = vi.mocked(window.showQuickPick).mock.calls[0] as [any[]];
    expect(items).toHaveLength(1);
    expect(items[0].description).toContain("prod-sales");
    expect(reveal).toHaveBeenCalledWith(prod.table, { select: true, focus: true });
  });

  it("leaves the tree unchanged when cancelled or when a connection refreshes during selection", async () => {
    const { command, provider, reveal } = await setup();
    vi.mocked(window.showQuickPick).mockResolvedValueOnce(undefined);
    await command();
    expect(reveal).not.toHaveBeenCalled();

    vi.mocked(window.showQuickPick).mockImplementationOnce(async (items: unknown) => {
      await provider.refresh(true);
      return (items as any[])[0];
    });
    await command();
    expect(reveal).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "The selected object was reloaded. Search again to locate it."
    );
  });
});
