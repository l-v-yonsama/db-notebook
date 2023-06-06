import { NOTEBOOK_TYPE, CELL_OPEN_MDH, CELL_SPECIFY_CONNECTION_TO_USE } from "../constant";
import { NodeKernel } from "./NodeKernel";
import { StateStorage } from "../utilities/StateStorage";
import {
  ResultSetData,
  ResultSetDataBuilder,
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta, NotebookMeta, RunResult } from "../types/Notebook";
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
  Uri,
  commands,
  notebooks,
  window,
  workspace,
} from "vscode";
import { log } from "../utilities/logger";
import { sqlKernelRun } from "./sqlKernel";
import path = require("path");
import { RecordRule } from "../shared/RecordRule";

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
  private interrupted: boolean = false;

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
      workspace.onDidChangeNotebookDocument((e) => {
        this.setActiveContext(e.notebook);
      })
    );
    context.subscriptions.push(
      workspace.onDidOpenNotebookDocument((notebook) => {
        this.setActiveContext(notebook);
      })
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new ConnectionSettingProvider(stateStorage)
      )
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new RdhProvider())
    );
    // context.subscriptions.push(
    //   notebooks.registerNotebookCellStatusBarItemProvider(
    //     NOTEBOOK_TYPE,
    //     new CheckActiveContextProvider(this)
    //   )
    // );
  }

  interruptHandler(notebook: NotebookDocument): void | Thenable<void> {
    log(`${PREFIX} interruptHandler`);
    this.interrupted = true;
  }

  setActiveContext(notebook: NotebookDocument) {
    const cells = notebook?.getCells() ?? [];
    const visibleVariables = cells.some((cell) => cell.outputs.length > 0);
    const visibleRdh = cells.some(
      (cell) =>
        cell.kind === NotebookCellKind.Code &&
        cell.document.languageId === "sql" &&
        cell.outputs.length > 0 &&
        cell.outputs[0].metadata?.rdh !== undefined
    );
    const hasSql = cells.some(
      (cell) => cell.kind === NotebookCellKind.Code && cell.document.languageId === "sql"
    );
    let noRules = true;
    if (notebook?.metadata?.rulesFolder) {
      noRules = false;
    }
    commands.executeCommand("setContext", "visibleVariables", visibleVariables);
    commands.executeCommand("setContext", "visibleRdh", visibleRdh);
    commands.executeCommand("setContext", "hasSql", hasSql);
    commands.executeCommand("setContext", "noRules", noRules);
  }

  getVariables() {
    return this.currentVariables;
  }

  dispose(): void {
    this._controller.dispose();
  }

  private async _executeAll(
    cells: NotebookCell[],
    notebook: NotebookDocument,
    _controller: NotebookController
  ): Promise<void> {
    this.interrupted = false;
    const connectionSettings = await this.stateStorage.getConnectionSettingList();
    this.kernel = new NodeKernel(connectionSettings);

    for (let cell of cells) {
      if (this.interrupted) {
        break;
      }
      await this._doExecution(notebook, cell);
    }
    this.currentVariables = await this.kernel.getStoredVariables();
    await this.kernel.dispose();
    // this.setActiveContext();
  }

  private async _doExecution(notebook: NotebookDocument, cell: NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);

    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    const outputs: NotebookCellOutput[] = [];
    let success = true;
    try {
      const { stdout, stderr, metadata } = await this.run(notebook, cell);
      if (stdout.length) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.text(stdout)], metadata));
      }
      if (stderr) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.stdout(stderr)]));
        success = false;
      }
      if (metadata?.rdh) {
        const withComment = metadata.rdh.keys.some((it) => (it.comment ?? "").length);
        outputs.push(
          new NotebookCellOutput(
            [
              NotebookCellOutputItem.text(
                ResultSetDataBuilder.from(metadata.rdh).toMarkdown({
                  withComment,
                }),
                "text/markdown"
              ),
            ],
            metadata
          )
        );
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

  private async run(notebook: NotebookDocument, cell: NotebookCell): Promise<RunResult> {
    if (cell.document.languageId === "sql") {
      const r = await sqlKernelRun(
        cell,
        this.stateStorage,
        await this.kernel!.getStoredVariables()
      );
      if (r.metadata?.rdh?.meta?.type === "select" && notebook.metadata?.rulesFolder) {
        const { tableName } = r.metadata.rdh.meta;
        let wsfolder = workspace.workspaceFolders?.[0].uri?.fsPath ?? "";
        const ruleFile = path.join(wsfolder, notebook.metadata?.rulesFolder, `${tableName}.rrule`);
        log(`${PREFIX} ruleFile:${ruleFile}`);
        try {
          const statResult = await workspace.fs.stat(Uri.file(ruleFile));
          log(`${PREFIX} statResult:${JSON.stringify(statResult)}`);
          if (statResult.size > 0) {
            const readData = await workspace.fs.readFile(Uri.file(ruleFile));
            const rrule = JSON.parse(Buffer.from(readData).toString("utf8")) as RecordRule;
            const runRuleEngineResult = await runRuleEngine(r.metadata.rdh, rrule.tableRule);
            log(`${PREFIX} runRuleEngineResult:${runRuleEngineResult}`);
          }
        } catch (_) {}
      }
      return r;
    }

    return this.kernel!.run(cell);
  }
}

// --- status bar
// class CheckActiveContextProvider implements NotebookCellStatusBarItemProvider {
//   constructor(private controller: MainController) {}

//   provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
//     this.controller.setActiveContext();
//     return undefined;
//   }
// }

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
    const rdh = <ResultSetData | undefined>cell.outputs[0]?.metadata?.["rdh"];
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
