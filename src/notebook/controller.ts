import { NOTEBOOK_TYPE, CELL_OPEN_MDH, CELL_SPECIFY_CONNECTION_TO_USE } from "./activator";
import { NodeKernel } from "./NodeKernel";
import { StateStorage } from "../utilities/StateStorage";
import {
  ConnectionSetting,
  DBDriverResolver,
  RDSBaseDriver,
  ResultSetDataHolder,
  normalizeQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta } from "../types/NotebookCell";
import { abbr } from "../utilities/stringUtil";
import { setupDbResource } from "./intellisense";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellKind,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookCellStatusBarAlignment,
  NotebookCellStatusBarItem,
  NotebookCellStatusBarItemProvider,
  NotebookController,
  NotebookDocument,
  commands,
  notebooks,
  window,
} from "vscode";
import { log } from "../utilities/logger";

const PREFIX = "[DBNotebookController]";

const hasMessageField = (error: any): error is { message: string } => {
  if ("message" in error && typeof error.message === "string") {
    return true;
  } else {
    return false;
  }
};

export class MainController {
  readonly controllerId = `${NOTEBOOK_TYPE}-controller`;
  readonly notebookType = NOTEBOOK_TYPE;
  readonly label = "Database Notebook";
  readonly supportedLanguages = ["sql", "javascript", "json"];
  private kernel: NodeKernel | undefined;

  private _executionOrder = 0;
  private readonly _controller: NotebookController;
  private currentVariables: { [key: string]: any } | undefined;

  constructor(private context: ExtensionContext, private stateStorage: StateStorage) {
    this._controller = notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._executeAll.bind(this);
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new ConnectionSettingProvider(stateStorage)
      )
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new RdhProvider())
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new CheckActiveContextProvider(this)
      )
    );
  }

  setActiveContext() {
    const cells = window.activeNotebookEditor?.notebook?.getCells() ?? [];
    const visibleVariables = cells.some((cell) => cell.outputs.length > 0);
    const visibleRdh = cells.some(
      (cell) =>
        cell.kind === NotebookCellKind.Code &&
        cell.document.languageId === "sql" &&
        cell.outputs.length > 0 &&
        cell.outputs[0].metadata?.rdh !== undefined
    );
    commands.executeCommand("setContext", "visibleVariables", visibleVariables);
    commands.executeCommand("setContext", "visibleRdh", visibleRdh);
  }

  getVariables() {
    return this.currentVariables;
  }

  dispose(): void {
    this._controller.dispose();
  }

  private async _executeAll(
    cells: NotebookCell[],
    _notebook: NotebookDocument,
    _controller: NotebookController
  ): Promise<void> {
    this.kernel = new NodeKernel(this.stateStorage.getConnectionSettingNames());
    for (let cell of cells) {
      await this._doExecution(cell);
    }
    this.currentVariables = await this.kernel.getStoredJson();
    await this.kernel.dispose();
    this.setActiveContext();
  }

  private async _doExecution(cell: NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);

    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    const outputs: NotebookCellOutput[] = [];
    let success = true;
    try {
      const { stdout, stderr, metadata } = await this.run(cell);
      outputs.push(new NotebookCellOutput([NotebookCellOutputItem.text(stdout)], metadata));
      if (stderr) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.stdout(stderr)]));
        success = false;
      }
    } catch (err: any) {
      console.error(err);
      success = false;
      if (hasMessageField(err)) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.stdout(err.message)]));
      } else {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.error(err)]));
      }
    }
    execution.replaceOutput(outputs);
    execution.end(success, Date.now());
  }

  private async run(cell: NotebookCell): Promise<RunResult> {
    if (cell.document.languageId === "sql") {
      return this.sqlKernelRun(cell);
    }

    return this.kernel!.run(cell);
  }

  private async sqlKernelRun(cell: NotebookCell): Promise<RunResult> {
    let stdout = "";
    let stderr = "";
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const storedJson = await this.kernel!.getStoredJson();
    const { connectionName }: CellMeta = cell.metadata;

    if (storedJson["_skipSql"] === true) {
      return {
        stdout,
        stderr: "Skipped.",
      };
    }
    if (connectionName) {
      connectionSetting = await this.stateStorage.getConnectionSettingByName(connectionName);
    } else {
      return {
        stdout,
        stderr: "Specify the connection name to be used.",
      };
    }
    if (!connectionSetting) {
      return {
        stdout,
        stderr: "Missing connection " + connectionName,
      };
    }
    const { query, binds } = normalizeQuery({
      query: cell.document.getText(),
      bindParams: storedJson,
    });
    log(`${PREFIX} query:` + query);
    log(`${PREFIX} binds:` + JSON.stringify(binds));

    const resolver = DBDriverResolver.getInstance();
    const driver = resolver.createDriver<RDSBaseDriver>(connectionSetting);

    const { ok, message, result } = await driver.flow(
      async () =>
        await driver.requestSql({
          sql: query,
          conditions: {
            binds,
          },
        })
    );
    resolver.removeDriver(driver);

    let metadata = undefined;
    if (ok && result) {
      if (!result.meta.tableName) {
        result.meta.tableName = `CELL${cell.index + 1}`;
      }
      metadata = { rdh: result };
      stdout = result?.toString()!;
    } else {
      stderr = message;
    }

    return {
      stdout,
      stderr,
      metadata,
    };
  }
}
export type RunResult = {
  stdout: string;
  stderr: string;
  metadata?: {
    rdh?: ResultSetDataHolder;
    [key: string]: any;
  };
};

// --- status bar
class CheckActiveContextProvider implements NotebookCellStatusBarItemProvider {
  constructor(private controller: MainController) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    this.controller.setActiveContext();
    return undefined;
  }
}

class ConnectionSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (cell.document.languageId !== "sql") {
      return undefined;
    }

    const { connectionName }: CellMeta = cell.metadata;
    let tooltip = "";
    if (connectionName) {
      if (this.stateStorage.hasConnectionSettingByName(connectionName)) {
        tooltip = "$(debug-disconnect) Use " + abbr(connectionName, 16);
        setupDbResource(connectionName);
      } else {
        tooltip = "$(error) Missing connection " + abbr(connectionName, 16);
      }
    } else {
      tooltip = "$(error) Specify connection";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_CONNECTION_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

class RdhProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rdh = <ResultSetDataHolder | undefined>cell.outputs[0]?.metadata?.["rdh"];
    if (!rdh) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(table) Open results",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_MDH;
    item.tooltip = "Open results in panel";
    return item;
  }
}
