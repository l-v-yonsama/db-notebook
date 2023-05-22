import { NOTEBOOK_TYPE, CELL_OPEN_MDH, CELL_SPECIFY_CONNECTION_TO_USE } from "./activator";
import { NodeKernel } from "./NodeKernel";
import { StateStorage } from "../utilities/StateStorage";
import { ResultSetDataHolder } from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta, RunResult } from "../types/Notebook";
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
import { sqlKernelRun } from "./sqlKernel";

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
    const connectionSettings = await this.stateStorage.getConnectionSettingList();
    this.kernel = new NodeKernel(connectionSettings);
    for (let cell of cells) {
      await this._doExecution(cell);
    }
    this.currentVariables = await this.kernel.getStoredVariables();
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
      return sqlKernelRun(cell, this.stateStorage, await this.kernel!.getStoredVariables());
    }

    return this.kernel!.run(cell);
  }
}

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
