import { DBType, DbConnection, RdsDatabase } from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands, workspace } from "vscode";
import type { ExtensionContext, TreeItem, TreeView } from "vscode";
import { LOAD_DB_SCHEMA } from "../../../src/constant";
import { registerResourceTreeCommand } from "../../../src/treeData/resource/ResourceTreeCommand";
import type { ResourceTreeProvider } from "../../../src/treeData/resource/ResourceTreeProvider";
import type { StateStorage } from "../../../src/utilities/StateStorage";

const mockDatabaseConfig = (resourceTreeAutoExpandTo: string) => {
  vi.mocked(workspace.getConfiguration).mockImplementation((section?: string) => {
    if (section !== "database") {
      return { get: (_key: string, defaultValue?: unknown) => defaultValue } as never;
    }
    return {
      get: (key: string, defaultValue?: unknown) =>
        key === "resourceTreeAutoExpandTo" ? resourceTreeAutoExpandTo : defaultValue,
    } as never;
  });
};

const getHandlerFor = (command: string): ((...args: unknown[]) => unknown) => {
  const call = vi.mocked(commands.registerCommand).mock.calls.find(([c]) => c === command);
  if (!call) {
    throw new Error(`command not registered: ${command}`);
  }
  return call[1] as (...args: unknown[]) => unknown;
};

const makeContext = (): ExtensionContext => ({ subscriptions: [] }) as unknown as ExtensionContext;

const revealMock = vi.fn(async () => undefined);

const makeDbResourceTreeView = (): TreeView<TreeItem> =>
  ({ reveal: revealMock } as unknown as TreeView<TreeItem>);

const makeDbResourceTree = (): ResourceTreeProvider =>
  ({
    changeConnectionTreeData: vi.fn(),
    forgetResourceTree: vi.fn(),
  } as unknown as ResourceTreeProvider);

const setupCommand = (loadResource: ReturnType<typeof vi.fn>) => {
  const context = makeContext();
  const dbResourceTree = makeDbResourceTree();
  const dbResourceTreeView = makeDbResourceTreeView();
  const stateStorage = { loadResource } as unknown as StateStorage;

  registerResourceTreeCommand({
    context,
    stateStorage,
    dbResourceTree,
    dbResourceTreeView,
    connectionSettingViewProvider: {} as never,
  });

  return getHandlerFor(LOAD_DB_SCHEMA);
};

describe(`${LOAD_DB_SCHEMA} と resourceTreeAutoExpandTo 設定の連携`, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("noneの場合、取得成功後もreveal()を呼ばない", async () => {
    mockDatabaseConfig("none");
    const conRes = new DbConnection({ name: "con1", dbType: DBType.MySQL });
    const dbRes = new RdsDatabase("db1");
    const loadResource = vi.fn(async () => ({ ok: true, message: "", result: { db: [dbRes], dbType: DBType.MySQL } }));
    const handler = setupCommand(loadResource);

    await handler(conRes);

    expect(revealMock).not.toHaveBeenCalled();
  });

  it.each([
    ["database", 1],
    ["schema", 2],
    ["table", 3],
  ] as const)("%sの場合、expand:%iでreveal()を1回呼ぶ", async (value, expand) => {
    mockDatabaseConfig(value);
    const conRes = new DbConnection({ name: "con1", dbType: DBType.MySQL });
    const dbRes = new RdsDatabase("db1");
    const loadResource = vi.fn(async () => ({ ok: true, message: "", result: { db: [dbRes], dbType: DBType.MySQL } }));
    const handler = setupCommand(loadResource);

    await handler(conRes);

    expect(revealMock).toHaveBeenCalledTimes(1);
    expect(revealMock).toHaveBeenCalledWith(conRes, { select: false, focus: false, expand });
  });

  it("取得失敗時は設定値にかかわらずreveal()を呼ばない", async () => {
    mockDatabaseConfig("table");
    const conRes = new DbConnection({ name: "con1", dbType: DBType.MySQL });
    const loadResource = vi.fn(async () => ({ ok: false, message: "error", result: undefined }));
    const handler = setupCommand(loadResource);

    await handler(conRes);

    expect(revealMock).not.toHaveBeenCalled();
  });
});
