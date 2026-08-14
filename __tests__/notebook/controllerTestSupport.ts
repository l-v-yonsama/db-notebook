// Shared mocks, fakes and helpers for the MainController test suite, split across:
//   - controller.construction.test.ts
//   - controller.execution.test.ts
//   - controller.kernelDispatch.test.ts
//   - controller.interrupt.test.ts
//
// vi.mock() calls are hoisted to the top of whichever file they are transformed in,
// including this one, so importing this module before "../../src/notebook/controller"
// keeps the same mocking behavior as the original single controller.test.ts file.
import { beforeEach, vi } from "vitest";
import type { Mock } from "vitest";
import { NotebookCellKind, notebooks } from "vscode";
import type { ExtensionContext, NotebookCell, NotebookDocument } from "vscode";
import type { RunResult } from "../../src/types/Notebook";
import type { CellMeta } from "../../src/types/Notebook";
import type { StateStorage } from "../../src/utilities/StateStorage";

// Importing MainController here (rather than separately in each split test file) keeps
// this the single place responsible for ensuring the vi.mock() calls above are hoisted
// and applied before the real, un-mocked kernel modules get loaded.
import { MainController } from "../../src/notebook/controller";

// NOTE: `export const { ... } = vi.hoisted(...)` is rejected by Vitest's hoisting
// transform ("Cannot export hoisted variable"), so the hoisted object is kept private
// and re-exported as individual const bindings below instead.
const hoistedMocks = vi.hoisted(() => ({
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
  redisKernelRunMock: vi.fn(),
  redisKernelInterruptMock: vi.fn(),
  jsonKernelRunMock: vi.fn(),
  shellKernelCreateMock: vi.fn(),
  shellKernelRunMock: vi.fn(),
  shellKernelInterruptMock: vi.fn(),
  existsFileOnWorkspaceMock: vi.fn(async () => false),
}));

export const nodeKernelCreateMock = hoistedMocks.nodeKernelCreateMock;
export const sqlKernelRunMock = hoistedMocks.sqlKernelRunMock;
export const sqlKernelInterruptMock = hoistedMocks.sqlKernelInterruptMock;
export const mqttKernelRunMock = hoistedMocks.mqttKernelRunMock;
export const mqttKernelRequestSqlMock = hoistedMocks.mqttKernelRequestSqlMock;
export const mqttKernelInterruptMock = hoistedMocks.mqttKernelInterruptMock;
export const awsKernelRunMock = hoistedMocks.awsKernelRunMock;
export const awsKernelInterruptMock = hoistedMocks.awsKernelInterruptMock;
export const memcachedKernelRunMock = hoistedMocks.memcachedKernelRunMock;
export const memcachedKernelInterruptMock = hoistedMocks.memcachedKernelInterruptMock;
export const redisKernelRunMock = hoistedMocks.redisKernelRunMock;
export const redisKernelInterruptMock = hoistedMocks.redisKernelInterruptMock;
export const jsonKernelRunMock = hoistedMocks.jsonKernelRunMock;
export const shellKernelCreateMock = hoistedMocks.shellKernelCreateMock;
export const shellKernelRunMock = hoistedMocks.shellKernelRunMock;
export const shellKernelInterruptMock = hoistedMocks.shellKernelInterruptMock;
export const existsFileOnWorkspaceMock = hoistedMocks.existsFileOnWorkspaceMock;

// These factories reference `hoistedMocks` directly (not the exported const bindings
// below) because only vi.hoisted()/vi.mock() calls are hoisted above the real module
// imports; the individual `export const` re-assignments are not, so at the time these
// factories run the exported bindings would still be in their temporal dead zone.
vi.mock("../../src/notebook/NodeKernel", () => ({
  NodeKernel: { create: hoistedMocks.nodeKernelCreateMock },
}));
vi.mock("../../src/notebook/sqlKernel", () => ({
  SqlKernel: vi.fn().mockImplementation(() => ({
    run: hoistedMocks.sqlKernelRunMock,
    interrupt: hoistedMocks.sqlKernelInterruptMock,
  })),
}));
vi.mock("../../src/notebook/MqttKernel", () => ({
  MqttKernel: vi.fn().mockImplementation(() => ({
    run: hoistedMocks.mqttKernelRunMock,
    requestSql: hoistedMocks.mqttKernelRequestSqlMock,
    interrupt: hoistedMocks.mqttKernelInterruptMock,
  })),
}));
vi.mock("../../src/notebook/awsKernel", () => ({
  AwsKernel: vi.fn().mockImplementation(() => ({
    run: hoistedMocks.awsKernelRunMock,
    interrupt: hoistedMocks.awsKernelInterruptMock,
  })),
}));
vi.mock("../../src/notebook/MemcachedKernel", () => ({
  MemcachedKernel: vi.fn().mockImplementation(() => ({
    run: hoistedMocks.memcachedKernelRunMock,
    interrupt: hoistedMocks.memcachedKernelInterruptMock,
  })),
}));
vi.mock("../../src/notebook/RedisKernel", () => ({
  RedisKernel: vi.fn().mockImplementation(() => ({
    run: hoistedMocks.redisKernelRunMock,
    interrupt: hoistedMocks.redisKernelInterruptMock,
  })),
}));
vi.mock("../../src/notebook/JsonKernel", () => ({
  jsonKernelRun: hoistedMocks.jsonKernelRunMock,
}));
vi.mock("../../src/notebook/ShellKernel", () => ({
  ShellKernel: { create: hoistedMocks.shellKernelCreateMock },
}));
vi.mock("../../src/utilities/configUtil", () => ({
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
vi.mock("../../src/utilities/fsUtil", () => ({
  existsFileOnWorkspace: hoistedMocks.existsFileOnWorkspaceMock,
  initializeStorageTmpPath: vi.fn(async () => undefined),
}));
vi.mock("../../src/utilities/lmUtil", () => ({
  runLm: vi.fn(async () => undefined),
}));

export type NodeKernelFake = {
  getStoredVariables: Mock;
  updateVariable: Mock;
  dispose: Mock;
  interrupt: Mock;
  run: Mock;
};

export const makeStateStorage = (overrides: Partial<Record<string, unknown>> = {}): StateStorage =>
  ({
    getConnectionSettingList: vi.fn(async () => []),
    getDBTypeByConnectionName: vi.fn(() => undefined),
    addSQLHistory: vi.fn(async () => true),
    getDefaultConnectionName: vi.fn(() => ""),
    ...overrides,
  } as unknown as StateStorage);

let cellSeq = 0;

export const makeCell = (
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

export const makeNotebook = (cells: NotebookCell[], path = "/fake/test.dbnb"): NotebookDocument => {
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

export const setupController = () => {
  const context = { subscriptions: [] } as unknown as ExtensionContext;
  const stateStorage = makeStateStorage();
  const controller = new MainController(context, stateStorage);
  const controllerObj = (notebooks.createNotebookController as Mock).mock.results.at(-1)!.value;
  return { controller, controllerObj, stateStorage };
};

export const lastExecution = (controllerObj: any) =>
  controllerObj.createNotebookCellExecution.mock.results.at(-1)!.value;

export let nodeKernelFake: NodeKernelFake;

/**
 * Registers the shared beforeEach hook (mock reset + NodeKernel/ShellKernel fakes)
 * for the calling test file. Call once at the top level of each split test file.
 */
export const registerControllerTestHooks = (): void => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodeKernelFake = {
      getStoredVariables: vi.fn(() => ({})),
      updateVariable: vi.fn(),
      dispose: vi.fn(async () => undefined),
      interrupt: vi.fn(),
      run: vi.fn(
        async () => ({ stdout: "", stderr: "", skipped: false, status: "executed" } as RunResult)
      ),
    };
    nodeKernelCreateMock.mockResolvedValue(nodeKernelFake);
    shellKernelCreateMock.mockResolvedValue({
      run: shellKernelRunMock,
      interrupt: shellKernelInterruptMock,
    });
    existsFileOnWorkspaceMock.mockResolvedValue(false);
  });
};
