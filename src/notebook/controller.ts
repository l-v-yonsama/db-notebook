import {
  NOTEBOOK_TYPE,
  CELL_OPEN_MDH,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CELL_SPECIFY_RULES_TO_USE,
  CELL_TOGGLE_SHOW_COMMENT,
  CELL_WRITE_TO_CLIPBOARD,
  CELL_SPECIFY_CODE_RESOLVER_TO_USE,
  CELL_MARK_CELL_AS_SKIP,
} from "../constant";
import { NodeKernel } from "./NodeKernel";
import { StateStorage } from "../utilities/StateStorage";
import {
  ResultSetData,
  ResultSetDataBuilder,
  runRuleEngine,
  resolveCodeLabel,
  abbr,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta, RunResult } from "../types/Notebook";
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
  workspace,
} from "vscode";
import { log } from "../utilities/logger";
import { SqlKernel } from "./sqlKernel";
import {
  isJsonCell,
  isSqlCell,
  readCodeResolverFile,
  readRuleFile,
} from "../utilities/notebookUtil";
import { jsonKernelRun } from "./JsonKernel";
import { existsFileOnStorage } from "../utilities/fsUtil";

const PREFIX = "[notebook/Controller]";

const hasMessageField = (error: any): error is { message: string } => {
  if ("message" in error && typeof error.message === "string") {
    return true;
  } else {
    return false;
  }
};

type NoteSession = {
  currentVariables: { [key: string]: any } | undefined;
  kernel: NodeKernel | undefined;
  sqlKernel: SqlKernel | undefined;
  interrupted: boolean;
};

export class MainController {
  readonly controllerId = `${NOTEBOOK_TYPE}-controller`;
  readonly notebookType = NOTEBOOK_TYPE;
  readonly label = "Database Notebook";
  readonly supportedLanguages = ["sql", "javascript", "json"];

  private _executionOrder = 0;
  private readonly _controller: NotebookController;
  private readonly noteSessions = new Map<string, NoteSession>();

  constructor(private context: ExtensionContext, private stateStorage: StateStorage) {
    this._controller = notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._executeAll.bind(this);
    this._controller.interruptHandler = this._interruptHandler.bind(this);

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
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new CommentProvider())
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new RecordRuleProvider(stateStorage)
      )
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new CodeLabelResolverProvider()
      )
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new MarkCellAsSkipProvider()
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new WriteToClipboardProvider()
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new RdhProvider())
    );
  }

  setActiveContext(notebook: NotebookDocument) {
    const cells = notebook?.getCells() ?? [];
    const visibleVariables = cells.some((cell) => cell.outputs.length > 0);
    const visibleRdh = cells.some(
      (cell) =>
        isSqlCell(cell) && cell.outputs.length > 0 && cell.outputs[0].metadata?.rdh !== undefined
    );
    const hasSql = cells.some((cell) => isSqlCell(cell));
    commands.executeCommand("setContext", "visibleVariables", visibleVariables);
    commands.executeCommand("setContext", "visibleRdh", visibleRdh);
    commands.executeCommand("setContext", "hasSql", hasSql);
  }

  getVariables(notebook: NotebookDocument) {
    return this.getNoteSession(notebook)?.currentVariables;
  }

  dispose(): void {
    log(`${PREFIX} dispose`);
    this._controller.dispose();
    log(`${PREFIX} disposed`);
  }

  private getNoteSession(notebook: NotebookDocument): NoteSession | undefined {
    return this.noteSessions.get(notebook.uri.path);
  }

  private _interruptHandler(notebook: NotebookDocument): void | Thenable<void> {
    log(`${PREFIX} interruptHandler`);
    const noteSession = this.getNoteSession(notebook);
    if (noteSession) {
      const { kernel, sqlKernel } = noteSession;
      try {
        noteSession.interrupted = true;
        if (kernel) {
          kernel.interrupt();
        } else {
          log(`${PREFIX} No NodeKernel`);
        }
        if (sqlKernel) {
          sqlKernel.interrupt();
        } else {
          log(`${PREFIX} No sqlKernel`);
        }
      } catch (e: any) {
        log(`${PREFIX} interruptHandler Error:${e.message}`);
      }
    }
  }

  private async _executeAll(
    cells: NotebookCell[],
    notebook: NotebookDocument,
    _controller: NotebookController
  ): Promise<void> {
    log(`${PREFIX} _executeAll START`);
    const connectionSettings = await this.stateStorage.getConnectionSettingList();
    const kernel = await NodeKernel.create(connectionSettings);
    let noteSession: NoteSession = {
      kernel,
      sqlKernel: undefined,
      currentVariables: undefined,
      interrupted: false,
    };
    this.noteSessions.set(notebook.uri.path, noteSession);

    for (let cell of cells) {
      if (noteSession.interrupted) {
        break;
      }
      await this._doExecution(notebook, cell);
      const tmp = this.getNoteSession(notebook);
      if (tmp) {
        noteSession = tmp;
      }
    }
    noteSession.currentVariables = kernel.getStoredVariables();
    await noteSession.kernel!.dispose();
    noteSession.kernel = undefined;
    this.noteSessions.delete(notebook.uri.path);

    log(`${PREFIX} _executeAll END`);
  }

  private async _doExecution(notebook: NotebookDocument, cell: NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);

    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    const outputs: NotebookCellOutput[] = [];
    let success = true;
    try {
      const { stdout, stderr, skipped, metadata } = await this.run(notebook, cell);
      if (stdout.length) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.text(stdout)], metadata));
      }
      if (stderr) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.stdout(stderr)]));
        success = false;
      }
      if (skipped) {
        outputs.push(
          new NotebookCellOutput([NotebookCellOutputItem.text("### `SKIPPED!`", "text/markdown")])
        );
      }
      if (metadata?.rdh) {
        const cellMeta: CellMeta = cell.metadata;
        const withComment = metadata.rdh.keys.some((it) => (it.comment ?? "").length);
        outputs.push(
          new NotebookCellOutput(
            [
              NotebookCellOutputItem.text(
                ResultSetDataBuilder.from(metadata.rdh).toMarkdown({
                  withComment,
                  withRowNo: true,
                  withCodeLabel: (cellMeta?.codeResolverFile ?? "").length > 0,
                  withRuleViolation: (cellMeta?.ruleFile ?? "").length > 0,
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
    if ((cell.metadata as CellMeta)?.markAsSkip === true) {
      return {
        stdout: "",
        stderr: "",
        skipped: true,
      };
    }
    const noteSession = this.getNoteSession(notebook);
    if (!noteSession) {
      throw new Error("Missing session");
    }

    if (!noteSession.kernel) {
      throw new Error("Missing kernel");
    }
    if (isSqlCell(cell)) {
      noteSession.sqlKernel = new SqlKernel(this.stateStorage);
      const r = await noteSession.sqlKernel.run(cell, noteSession.kernel.getStoredVariables());
      noteSession.sqlKernel = undefined;
      if (r.metadata?.rdh?.meta?.type === "select") {
        const metadata: CellMeta = cell.metadata;
        if (metadata.ruleFile && (await existsFileOnStorage(metadata.ruleFile))) {
          const rrule = await readRuleFile(cell, r.metadata.rdh);
          if (rrule) {
            r.metadata.rdh.meta.tableRule = rrule.tableRule;
            log(`${PREFIX} rrule.tableRule:${JSON.stringify(rrule.tableRule, null, 1)}`);
            try {
              const runRuleEngineResult = await runRuleEngine(r.metadata.rdh);
              log(`${PREFIX} runRuleEngineResult:${runRuleEngineResult}`);
            } catch (e) {
              throw new Error(
                `RuleEngineError:${(e as Error).message}. Unuse or review the following file. ${
                  metadata.ruleFile
                }`
              );
            }
          }
        }
        if (metadata.codeResolverFile && (await existsFileOnStorage(metadata.codeResolverFile))) {
          const codeResolver = await readCodeResolverFile(cell);
          if (codeResolver) {
            r.metadata.rdh.meta.codeItems = codeResolver.items;
            const resolveCodeLabelResult = await resolveCodeLabel(r.metadata.rdh);
            log(`${PREFIX} resolveCodeLabel:${resolveCodeLabelResult}`);
          }
        }
      }

      return r;
    } else if (isJsonCell(cell)) {
      return await jsonKernelRun(cell, noteSession.kernel);
    }

    return noteSession.kernel!.run(cell);
  }
}

// --- status bar
class RecordRuleProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (!isSqlCell(cell)) {
      return undefined;
    }
    if (!cell.document.getText().toLocaleLowerCase().includes("select")) {
      return undefined;
    }

    const { ruleFile }: CellMeta = cell.metadata;
    let tooltip = "";
    if (ruleFile) {
      let displayFileName = ruleFile;
      if (displayFileName.endsWith(".rrule")) {
        displayFileName = displayFileName.substring(0, displayFileName.length - 6);
      }
      if (await existsFileOnStorage(ruleFile)) {
        tooltip = "$(checklist) Use " + abbr(displayFileName, 18);
      } else {
        tooltip = "$(warning) Missing Rule " + abbr(displayFileName, 18);
      }
    } else {
      tooltip = "$(info) Specify Rule";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_RULES_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

class CodeLabelResolverProvider implements NotebookCellStatusBarItemProvider {
  constructor() {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (!isSqlCell(cell)) {
      return undefined;
    }
    if (!cell.document.getText().toLocaleLowerCase().includes("select")) {
      return undefined;
    }

    const { codeResolverFile }: CellMeta = cell.metadata;
    let tooltip = "";
    if (codeResolverFile) {
      let displayFileName = codeResolverFile;
      if (displayFileName.endsWith(".cresolver")) {
        displayFileName = displayFileName.substring(0, displayFileName.length - 10);
      }
      if (await existsFileOnStorage(codeResolverFile)) {
        tooltip = "$(replace) Use " + abbr(displayFileName, 18);
      } else {
        tooltip = "$(warning) Missing Code resolver " + abbr(displayFileName, 18);
      }
    } else {
      tooltip = "$(info) Specify Code resolver";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_CODE_RESOLVER_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

class MarkCellAsSkipProvider implements NotebookCellStatusBarItemProvider {
  constructor() {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (cell.kind === NotebookCellKind.Markup) {
      return undefined;
    }

    const { markAsSkip }: CellMeta = cell.metadata;
    let tooltip = "";
    let text = "";
    if (markAsSkip === true) {
      tooltip = "Mark cell as enabled";
      text = "$(debug-step-over) Enabled";
    } else {
      tooltip = "Mark cell as skip";
      text = "$(debug-step-over) Skip";
    }
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_MARK_CELL_AS_SKIP;
    item.tooltip = tooltip;
    return item;
  }
}

class CommentProvider implements NotebookCellStatusBarItemProvider {
  constructor() {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (!isSqlCell(cell)) {
      return undefined;
    }

    const { showComment }: CellMeta = cell.metadata;
    let tooltip = "";
    if (showComment === true) {
      tooltip = "$(eye-closed) Hide comment";
    } else {
      tooltip = "$(eye) Show comment";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_TOGGLE_SHOW_COMMENT;
    item.tooltip = tooltip;
    return item;
  }
}

class ConnectionSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isSqlCell(cell)) {
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

class WriteToClipboardProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rdh = <ResultSetData | undefined>cell.outputs[0]?.metadata?.["rdh"];
    if (!rdh) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(clippy) Write to clipbaord",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_WRITE_TO_CLIPBOARD;
    item.tooltip = "Write to clipbaord";
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
