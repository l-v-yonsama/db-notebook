import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands, window } from "vscode";
import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { DELETE_ALL_HISTORIES, EXECUTE_QUERY_HISTORY } from "../../../src/constant";
import type { QueryHistory } from "../../../src/types/QueryHistory";

const createRDSDriver = vi.fn();
const createSQLSupportDriver = vi.fn();
const workflow = vi.fn();

vi.mock("../../../src/utilities/driverResolver", () => ({
  createRDSDriver: (...args: unknown[]) => createRDSDriver(...args),
  createSQLSupportDriver: (...args: unknown[]) => createSQLSupportDriver(...args),
  workflow: (...args: unknown[]) => workflow(...args),
}));

vi.mock("../../../src/panels/DynamoQueryPanel", () => ({
  DynamoQueryPanel: { render: vi.fn() },
}));

vi.mock("../../../src/performanceTuning/preview/performanceTuningBindConfirmation", () => ({
  openPerformanceTuningPreview: vi.fn(),
  openDynamoDbPerformanceTuningPreview: vi.fn(),
}));

const { registerHistoryTreeCommand } = await import(
  "../../../src/treeData/history/HistoryTreeCommand"
);

// A PartiQL entry: DynamoDB reached through a SQL cell, so dbType is Aws while
// request.kind stays "sql" (only Query Panel entries are "dynamodbQuery").
const partiqlHistory: QueryHistory = {
  id: "h1",
  connectionName: "aws1",
  sqlDoc: `SELECT * FROM "Order"`,
  status: "success",
  request: { kind: "sql" },
};

const registerAndGetHandler = (
  stateStorage: unknown,
  historyTreeProvider: unknown,
  commandName = EXECUTE_QUERY_HISTORY,
  rpcHistoryStore: unknown = { list: async () => [], clear: async () => undefined }
) => {
  const registered = new Map<string, (...args: any[]) => any>();
  vi.mocked(commands.registerCommand).mockImplementation(((
    command: string,
    callback: (...args: unknown[]) => unknown
  ) => {
    registered.set(command, callback);
    return { dispose: () => {} };
  }) as never);

  registerHistoryTreeCommand({
    context: { extensionUri: {}, subscriptions: [] } as never,
    stateStorage: stateStorage as never,
    historyTreeProvider: historyTreeProvider as never,
    rpcHistoryStore: rpcHistoryStore as never,
  });

  const handler = registered.get(commandName);
  if (!handler) {
    throw new Error(`${commandName} was not registered`);
  }
  return handler;
};

describe("EXECUTE_QUERY_HISTORY", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PartiQL履歴(dbType:Aws)をRDS専用ドライバに通さずSQLサポートドライバで実行する", async () => {
    createSQLSupportDriver.mockResolvedValue({
      // AwsDriver's own answers - PartiQL has no positional placeholders.
      isPositionedParameterAvailable: () => false,
      getPositionalCharacter: () => undefined,
    });
    createRDSDriver.mockRejectedValue(new Error("Aws is not a relational database"));
    workflow.mockResolvedValue({
      ok: true,
      result: { meta: { tableName: "Order" }, summary: { selectedRows: 1 } },
    });

    const stateStorage = {
      getConnectionSettingByName: vi.fn(async () => ({ name: "aws1", dbType: DBType.Aws })),
      addQueryHistory: vi.fn(async () => undefined),
      deleteQueryHistoryByID: vi.fn(async () => undefined),
      getQueryHistoryList: vi.fn(async () => []),
    };
    const historyTreeProvider = { refresh: vi.fn(async () => undefined) };

    const execute = registerAndGetHandler(stateStorage, historyTreeProvider);
    await execute(partiqlHistory);

    expect(createRDSDriver).not.toHaveBeenCalled();
    expect(createSQLSupportDriver).toHaveBeenCalledTimes(1);
    expect(workflow).toHaveBeenCalledTimes(1);
    expect(stateStorage.addQueryHistory).toHaveBeenCalledWith(
      expect.objectContaining({ connectionName: "aws1", status: "success" })
    );
  });

  it("RDB履歴も同じ経路で実行できる", async () => {
    createSQLSupportDriver.mockResolvedValue({
      isPositionedParameterAvailable: () => false,
      getPositionalCharacter: () => undefined,
    });
    workflow.mockResolvedValue({
      ok: true,
      result: { meta: { tableName: "t" }, summary: { selectedRows: 2 } },
    });

    const stateStorage = {
      getConnectionSettingByName: vi.fn(async () => ({ name: "mysql1", dbType: DBType.MySQL })),
      addQueryHistory: vi.fn(async () => undefined),
      deleteQueryHistoryByID: vi.fn(async () => undefined),
      getQueryHistoryList: vi.fn(async () => []),
    };
    const historyTreeProvider = { refresh: vi.fn(async () => undefined) };

    const execute = registerAndGetHandler(stateStorage, historyTreeProvider);
    await execute({
      id: "h2",
      connectionName: "mysql1",
      sqlDoc: "select * from t",
      status: "success",
    } as QueryHistory);

    expect(createRDSDriver).not.toHaveBeenCalled();
    expect(createSQLSupportDriver).toHaveBeenCalledTimes(1);
    expect(workflow).toHaveBeenCalledTimes(1);
  });

  it("clears Query and RPC histories together from the unified view", async () => {
    const stateStorage = {
      getQueryHistoryList: vi.fn(async () => [partiqlHistory]),
      deleteAllQueryHistories: vi.fn(async () => true),
    };
    const rpcHistoryStore = {
      list: vi.fn(async () => [{ id: "rpc" }]),
      clear: vi.fn(async () => undefined),
    };
    const historyTreeProvider = { refresh: vi.fn(async () => undefined) };
    vi.mocked(window.showWarningMessage).mockResolvedValue("Delete all" as never);
    const clear = registerAndGetHandler(
      stateStorage, historyTreeProvider, DELETE_ALL_HISTORIES, rpcHistoryStore
    );

    await clear();

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      "Delete all histories? Query: 1, RPC: 1.", { modal: true }, "Delete all"
    );
    expect(stateStorage.deleteAllQueryHistories).toHaveBeenCalledTimes(1);
    expect(rpcHistoryStore.clear).toHaveBeenCalledTimes(1);
    expect(historyTreeProvider.refresh).toHaveBeenCalledWith(true);
  });
});
