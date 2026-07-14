import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { commands, NotebookCellKind, notebooks, window, workspace } from "vscode";
import type { ExtensionContext, NotebookCell, NotebookDocument } from "vscode";
import { OPEN_CHARTS_VIEWER, REFRESH_SQL_HISTORIES } from "../constant";
import type { RunResult } from "../types/Notebook";
import type { CellMeta } from "../types/Notebook";
import type { StateStorage } from "../utilities/StateStorage";

const {
  nodeKernelCreateMock,
  sqlKernelRunMock,
  sqlKernelInterruptMock,
  mqttKernelRunMock,
  mqttKernelRequestSqlMock,
  mqttKernelInterruptMock,
  awsKernelRunMock,
  awsKernelInterruptMock,
  memcachedKernelRunMock,
  memcachedKernelInterruptMock,
  jsonKernelRunMock,
  existsFileOnWorkspaceMock,
} = vi.hoisted(() => ({
  nodeKernelCreateMock: vi.fn(),
  sqlKernelRunMock: vi.fn(),
  sqlKernelInterruptMock: vi.fn(),
  mqttKernelRunMock: vi.fn(),
  mqttKernelRequestSqlMock: vi.fn(),
  mqttKernelInterruptMock: vi.fn(),
  awsKernelRunMock: vi.fn(),
  awsKernelInterruptMock: vi.fn(),
  memcachedKernelRunMock: vi.fn(),
  memcachedKernelInterruptMock: vi.fn(),
  jsonKernelRunMock: vi.fn(),
  existsFileOnWorkspaceMock: vi.fn(async () => false),
}));

vi.mock("./NodeKernel", () => ({
  NodeKernel: { create: nodeKernelCreateMock },
}));
vi.mock("./sqlKernel", () => ({
  SqlKernel: vi.fn().mockImplementation(() => ({
    run: sqlKernelRunMock,
    interrupt: sqlKernelInterruptMock,
  })),
}));
vi.mock("./MqttKernel", () => ({
  MqttKernel: vi.fn().mockImplementation(() => ({
    run: mqttKernelRunMock,
    requestSql: mqttKernelRequestSqlMock,
    interrupt: mqttKernelInterruptMock,
  })),
}));
vi.mock("./awsKernel", () => ({
  AwsKernel: vi.fn().mockImplementation(() => ({
    run: awsKernelRunMock,
    interrupt: awsKernelInterruptMock,
  })),
}));
vi.mock("./MemcachedKernel", () => ({
  MemcachedKernel: vi.fn().mockImplementation(() => ({
    run: memcachedKernelRunMock,
    interrupt: memcachedKernelInterruptMock,
  })),
}));
vi.mock("./JsonKernel", () => ({
  jsonKernelRun: jsonKernelRunMock,
}));
vi.mock("../utilities/configUtil", () => ({
  getNodeConfig: () => ({
    commandPath: "",
    dataEncoding: "utf8",
    tmpDirPath: "/tmp/db-notebook-test",
  }),
  getResultsetConfig: () => ({
    header: { displayComment: false, displayType: false },
    displayRowno: false,
    maxCharactersInCell: 100,
    maxRowsInPreview: 10,
    dateFormat: "YYYY-MM-DD",
    timestampFormat: "YYYY-MM-DD HH:mm:ss",
    eol: "\n",
    binaryToHex: false,
  }),
  getToStringParamByConfig: (options?: Record<string, unknown>) => ({
    maxPrintLines: 10,
    maxCellValueLength: 100,
    withType: false,
    withComment: false,
    withRowNo: false,
    withCodeLabel: false,
    withRuleViolation: false,
    dateFormat: "YYYY-MM-DD",
    timestampFormat: "YYYY-MM-DD HH:mm:ss",
    eol: "\n",
    binaryToHex: false,
    ...options,
  }),
}));
vi.mock("../utilities/fsUtil", () => ({
  existsFileOnWorkspace: existsFileOnWorkspaceMock,
  initializeStorageTmpPath: vi.fn(async () => undefined),
}));
vi.mock("../utilities/lmUtil", () => ({
  runLm: vi.fn(async () => undefined),
}));

import { MainController } from "./controller";

type NodeKernelFake = {
  getStoredVariables: Mock;
  updateVariable: Mock;
  dispose: Mock;
  interrupt: Mock;
  run: Mock;
};

const makeStateStorage = (overrides: Partial<Record<string, unknown>> = {}): StateStorage =>
  ({
    getConnectionSettingList: vi.fn(async () => []),
    getDBTypeByConnectionName: vi.fn(() => undefined),
    addSQLHistory: vi.fn(async () => true),
    getDefaultConnectionName: vi.fn(() => ""),
    ...overrides,
  } as unknown as StateStorage);

let cellSeq = 0;

const makeCell = (
  opts: {
    languageId?: string;
    kind?: NotebookCellKind;
    metadata?: CellMeta;
    text?: string;
  } = {}
): NotebookCell => {
  const text = opts.text ?? "";
  const docUriPath = `/fake/cell-${cellSeq++}.txt`;
  return {
    kind: opts.kind ?? NotebookCellKind.Code,
    index: 0,
    metadata: opts.metadata ?? {},
    outputs: [],
    document: {
      languageId: opts.languageId ?? "javascript",
      uri: { path: docUriPath, toString: () => docUriPath },
      getText: () => text,
      positionAt: (offset: number) => ({ line: 0, character: offset }),
    },
  } as unknown as NotebookCell;
};

const makeNotebook = (cells: NotebookCell[], path = "/fake/test.dbnb"): NotebookDocument => {
  const uri = { path, toString: () => path };
  const notebook = {
    uri,
    getCells: () => cells,
  } as unknown as NotebookDocument;
  cells.forEach((cell) => {
    (cell as unknown as { notebook: NotebookDocument }).notebook = notebook;
  });
  return notebook;
};

const setupController = () => {
  const context = { subscriptions: [] } as unknown as ExtensionContext;
  const stateStorage = makeStateStorage();
  const controller = new MainController(context, stateStorage);
  const controllerObj = (notebooks.createNotebookController as Mock).mock.results.at(-1)!.value;
  return { controller, controllerObj, stateStorage };
};

const lastExecution = (controllerObj: any) =>
  controllerObj.createNotebookCellExecution.mock.results.at(-1)!.value;

let nodeKernelFake: NodeKernelFake;

beforeEach(() => {
  vi.clearAllMocks();
  nodeKernelFake = {
    getStoredVariables: vi.fn(() => ({})),
    updateVariable: vi.fn(),
    dispose: vi.fn(async () => undefined),
    interrupt: vi.fn(),
    run: vi.fn(
      async () =>
        ({ stdout: "", stderr: "", skipped: false, status: "executed" } as RunResult)
    ),
  };
  nodeKernelCreateMock.mockResolvedValue(nodeKernelFake);
  existsFileOnWorkspaceMock.mockResolvedValue(false);
});

describe("MainController construction", () => {
  it("wires the notebook controller to _executeAll/_interruptHandler", () => {
    const { controller, controllerObj } = setupController();

    expect(controllerObj.supportedLanguages).toEqual(controller.supportedLanguages);
    expect(controllerObj.supportsExecutionOrder).toBe(true);
    expect(typeof controllerObj.executeHandler).toBe("function");
    expect(typeof controllerObj.interruptHandler).toBe("function");
  });
});

describe("MainController.execute -> _doExecution", () => {
  it("SQLのSELECT結果からrdh markdown出力を作り、chart設定があればビューアを開く", async () => {
    const { controllerObj, stateStorage } = setupController();
    (stateStorage.getDBTypeByConnectionName as Mock).mockReturnValue(DBType.Postgres);

    const rdh = ResultSetDataBuilder.createEmpty().build();
    rdh.meta.type = "select";
    rdh.summary = { info: "1 rows" } as any;
    sqlKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
      metadata: { rdh },
    } as RunResult);

    const cell = makeCell({
      languageId: "sql",
      metadata: {
        connectionName: "conn1",
        chart: { title: "t" } as any,
      },
    });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.outputs[0].items[0].data).toContain("[Query Result]");
    expect(execution.outputs[0].items[0].data).toContain("1 rows");
    expect(execution.endedAt.success).toBe(true);

    expect(commands.executeCommand).toHaveBeenCalledWith(
      OPEN_CHARTS_VIEWER,
      expect.objectContaining({ rdh })
    );
    expect(stateStorage.addSQLHistory).toHaveBeenCalledWith(
      expect.objectContaining({ connectionName: "conn1" })
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(REFRESH_SQL_HISTORIES);
  });

  it("stderrが返るとstderr出力を積んで失敗として終了する", async () => {
    const { controllerObj } = setupController();
    sqlKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "boom",
      skipped: false,
      status: "error",
    } as RunResult);

    const cell = makeCell({ languageId: "sql", metadata: { connectionName: "conn1" } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    const stderrItem = execution.outputs.find(
      (o: any) => o.items[0].mime === "application/vnd.code.notebook.stderr"
    );
    expect(stderrItem.items[0].data).toBe("boom");
    expect(execution.endedAt.success).toBe(false);
  });

  it("markAsSkipのセルはカーネルを呼ばずにSKIPPED出力を積む", async () => {
    const { controllerObj } = setupController();
    const cell = makeCell({ languageId: "sql", metadata: { markAsSkip: true } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.outputs.some((o: any) => o.items[0].data === "### `SKIPPED!`")).toBe(true);
    expect(sqlKernelRunMock).not.toHaveBeenCalled();
    expect(execution.endedAt.success).toBe(true);
  });

  it("run()が例外を投げた場合はcatchされエラー出力を積んで失敗として終了する", async () => {
    const { controllerObj } = setupController();
    nodeKernelFake.run.mockRejectedValue(new Error("boom"));

    const cell = makeCell({ languageId: "javascript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.outputs[0].items[0].data).toBe("boom");
    expect(execution.endedAt.success).toBe(false);
  });

  it("savingSharedVariablesが指定されていれば共有変数を更新する", async () => {
    const { controllerObj } = setupController();
    nodeKernelFake.run.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({
      languageId: "javascript",
      metadata: { savingSharedVariables: true, sharedVariableName: "myVar" },
    });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(nodeKernelFake.updateVariable).toHaveBeenCalledWith(
      "myVar",
      expect.objectContaining({ success: true, stdout: "ok", status: "executed" })
    );
  });

  it("updateJSONCellValuesで対象のJSONセルにマージ結果を書き戻す", async () => {
    const { controllerObj } = setupController();
    nodeKernelFake.run.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
      metadata: {
        updateJSONCellValues: [{ cellIndex: 0, replaceAll: false, data: { a: 1 } }],
      },
    } as RunResult);

    const jsonCell = makeCell({
      languageId: "json",
      metadata: { markAsRunInOrderAtJsonCell: true },
      text: '{"a":0,"b":2}',
    });
    const execCell = makeCell({ languageId: "javascript" });
    const notebook = makeNotebook([jsonCell, execCell]);

    await controllerObj.executeHandler([execCell], notebook, controllerObj);

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    const editArg = (workspace.applyEdit as Mock).mock.calls[0][0];
    const edits = editArg.get((jsonCell.document as unknown as { uri: unknown }).uri);
    expect(edits[0].newText).toContain('"a": 1');
    expect(edits[0].newText).toContain('"b": 2');
  });
});

describe("MainController.execute -> run() dispatch", () => {
  it("MQTT接続のSQLセルはmqttKernel.requestSqlへ委譲する", async () => {
    const { controllerObj, stateStorage } = setupController();
    (stateStorage.getDBTypeByConnectionName as Mock).mockReturnValue(DBType.Mqtt);
    mqttKernelRequestSqlMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "sql", metadata: { connectionName: "conn1" } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(mqttKernelRequestSqlMock).toHaveBeenCalled();
    expect(sqlKernelRunMock).not.toHaveBeenCalled();
  });

  it("cwqlセルはawsKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    awsKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "cwql" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(awsKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("memcachedセルはmemcachedKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    memcachedKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "memcached" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(memcachedKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("publishParams付きセルはmqttKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    mqttKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "json", metadata: { publishParams: {} as any } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(mqttKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("publishParamsの無いJSONセルはjsonKernelRunへ委譲する", async () => {
    const { controllerObj } = setupController();
    jsonKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "json" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(jsonKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake);
  });

  it("それ以外の言語(javascript)はNodeKernel.runへフォールバックする", async () => {
    const { controllerObj } = setupController();

    const cell = makeCell({ languageId: "javascript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(nodeKernelFake.run).toHaveBeenCalledWith(cell);
  });
});

describe("MainController._interruptHandler", () => {
  it("実行中セッションが無くても例外を投げずにステータスバーへ通知する", () => {
    const { controllerObj } = setupController();
    const notebook = makeNotebook([]);

    expect(() => controllerObj.interruptHandler(notebook)).not.toThrow();
    expect(window.setStatusBarMessage).toHaveBeenCalledWith("Interrupted", 3000);
  });

  it("実行中にinterruptすると使用中のカーネルにinterrupt()が伝播する", async () => {
    const { controllerObj } = setupController();
    let resolveRun!: (r: RunResult) => void;
    const pendingRun = new Promise<RunResult>((resolve) => {
      resolveRun = resolve;
    });
    nodeKernelFake.run.mockReturnValue(pendingRun);

    const cell = makeCell({ languageId: "javascript" });
    const notebook = makeNotebook([cell]);

    const execPromise = controllerObj.executeHandler([cell], notebook, controllerObj);
    await vi.waitFor(() => expect(nodeKernelFake.run).toHaveBeenCalled());

    controllerObj.interruptHandler(notebook);
    expect(nodeKernelFake.interrupt).toHaveBeenCalled();

    resolveRun({ stdout: "", stderr: "", skipped: false, status: "executed" });
    await execPromise;
  });
});
