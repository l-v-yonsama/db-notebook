import { runRuleEngine } from "@l-v-yonsama/multi-platform-database-drivers";
import { abbr, resolveCodeLabel, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import {
  CancellationTokenSource,
  commands,
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
  NotebookEdit,
  notebooks,
  Range,
  TextEdit,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import {
  CELL_MARK_CELL_AS_PRE_EXECUTION,
  CELL_MARK_CELL_AS_SKIP,
  CELL_OPEN_HTTP_RESPONSE,
  CELL_OPEN_MDH,
  CELL_SHOW_METADATA_SETTINGS,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CELL_SPECIFY_LOG_GROUP_START_TIME_OFFSET_TO_USE,
  CELL_SPECIFY_LOG_GROUP_TO_USE,
  NOTEBOOK_TYPE,
  OPEN_CHARTS_VIEWER,
  REFRESH_SQL_HISTORIES,
} from "../constant";
import type { RunResultMetadata } from "../shared/RunResultMetadata";
import { CellMeta, LMEvaluateTarget, RunResult, SQLMode } from "../types/Notebook";
import { ChartsViewParams } from "../types/views";
import {
  getNodeConfig,
  getResultsetConfig,
  getToStringParamByConfig,
} from "../utilities/configUtil";
import { existsFileOnWorkspace, initializeStorageTmpPath } from "../utilities/fsUtil";
import { createResponseBodyMarkdown } from "../utilities/httpUtil";
import { runLm } from "../utilities/lmUtil";
import { log, logError } from "../utilities/logger";
import {
  hasAnyRdhOutputCell,
  isCwqlCell,
  isJsonCell,
  isPreExecution,
  isSqlCell,
  readCodeResolverFile,
  readRuleFile,
} from "../utilities/notebookUtil";
import { StateStorage } from "../utilities/StateStorage";
import { AwsKernel } from "./awsKernel";
import { setupDbResource } from "./intellisense";
import { jsonKernelRun } from "./JsonKernel";
import { NodeKernel } from "./NodeKernel";
import { SqlKernel } from "./sqlKernel";

const PREFIX = "[notebook/Controller]";

type NoteSession = {
  executionOrder: number;
  kernel: NodeKernel | undefined;
  sqlKernel: SqlKernel | undefined;
  awsKernel: AwsKernel | undefined;
  cancellationTokenSourceList: CancellationTokenSource[] | undefined;
  interrupted: boolean;
};

export class MainController {
  readonly controllerId = `${NOTEBOOK_TYPE}-controller`;
  readonly notebookType = NOTEBOOK_TYPE;
  readonly label = "Database Notebook";
  readonly supportedLanguages = ["sql", "javascript", "json", "cwql"];

  private readonly _controller: NotebookController;
  private readonly noteSessions = new Map<string, NoteSession>();
  private readonly noteVariables = new Map<string, { [key: string]: any }>();
  private sqlMode: SQLMode | undefined = undefined;
  private lmEvaluateTarget: LMEvaluateTarget | undefined = undefined;

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

    workspace.onDidCloseNotebookDocument((e) => {
      this.noteVariables.delete(e.uri.path);
    });

    window.onDidChangeActiveNotebookEditor((notebookEditor) => {
      // log(
      //   PREFIX +
      //     " onDidChangeActiveNotebookEditor notebookEditor.notebookType:" +
      //     notebookEditor?.notebook?.notebookType
      // );
      if (notebookEditor?.notebook) {
        this.setActiveContext(notebookEditor.notebook);
      }
    });

    context.subscriptions.push(
      workspace.onDidChangeNotebookDocument((e) => {
        // log(
        //   PREFIX + " onDidChangeNotebookDocument e.notebook.notebookType:" + e.notebook.notebookType
        // );
        if (e.notebook.notebookType !== NOTEBOOK_TYPE) {
          return;
        }

        e.contentChanges.forEach((change) => {
          change.addedCells.forEach(async (cell) => {
            if (cell.document.languageId === "sql") {
              const cm = cell.metadata as CellMeta;
              if (!cm.connectionName) {
                const metadata: CellMeta = {
                  ...cell.metadata,
                };
                metadata.connectionName = this.stateStorage.getDefaultConnectionName();
                const edit = new WorkspaceEdit();
                const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
                edit.set(cell.notebook.uri, [nbEdit]);
                await workspace.applyEdit(edit);
              }
              resetCellContext(cell);
            }
          });
        });
        this.setActiveContext(e.notebook);
      })
    );
    context.subscriptions.push(
      workspace.onDidOpenNotebookDocument((notebook) => {
        // log(PREFIX + " onDidOpenNotebookDocument e.notebook.notebookType:" + notebook.notebookType);
        if (notebook.notebookType !== NOTEBOOK_TYPE) {
          return;
        }
        this.setActiveContext(notebook);
      })
    );

    //---------------------------
    // STATUS BAR ITEM PROVIDERS
    //---------------------------
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new MarkCellAsSkipProvider()
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new PreExecutionProvider())
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new ConnectionSettingProvider(stateStorage)
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new LogGroupSettingProvider(stateStorage)
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new LogGroupQueryTimeSettingProvider(stateStorage)
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new CellMetadataProvider(stateStorage)
      )
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new RdhProvider())
    );

    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new HttpResponseProvider())
    );
  }

  setSqlMode(sqlMode: SQLMode): void {
    this.sqlMode = sqlMode;
  }

  setLMEvaluateTarget(lmEvaluateTarget: LMEvaluateTarget): void {
    this.lmEvaluateTarget = lmEvaluateTarget;
  }

  setActiveContext(notebook: NotebookDocument) {
    const cells = notebook?.getCells() ?? [];
    const visibleVariables = cells.some((cell) => cell.outputs.length > 0);
    const visibleRdh = cells.some((cell) => hasAnyRdhOutputCell(cell));
    const hasSql = cells.some((cell) => isSqlCell(cell));
    commands.executeCommand("setContext", "visibleVariables", visibleVariables);
    commands.executeCommand("setContext", "visibleRdh", visibleRdh);
    commands.executeCommand("setContext", "hasSql", hasSql);
  }

  getVariables(notebook: NotebookDocument): { [key: string]: any } | undefined {
    return this.noteVariables.get(notebook.uri.path);
  }

  dispose(): void {
    // log(`${PREFIX} dispose`);
    this._controller.dispose();
  }

  private getNoteSession(notebook: NotebookDocument): NoteSession | undefined {
    return this.noteSessions.get(notebook.uri.path);
  }

  private _interruptHandler(notebook: NotebookDocument): void | Thenable<void> {
    // log(`${PREFIX} interruptHandler`);
    const noteSession = this.getNoteSession(notebook);
    if (noteSession) {
      const { kernel, sqlKernel, awsKernel, cancellationTokenSourceList } = noteSession;
      try {
        noteSession.interrupted = true;
        if (kernel) {
          kernel.interrupt();
        } else {
          // log(`${PREFIX} No NodeKernel`);
        }
        if (sqlKernel) {
          sqlKernel.interrupt();
        } else {
          // log(`${PREFIX} No sqlKernel`);
        }
        if (awsKernel) {
          awsKernel.interrupt();
        }
        if (cancellationTokenSourceList) {
          for (const cts of cancellationTokenSourceList) {
            cts.cancel();
          }
        }
      } catch (e) {
        if (e instanceof Error) {
          log(`${PREFIX} interruptHandler Error:${e.message}`);
        } else {
          log(`${PREFIX} interruptHandler Error:${e}`);
        }
      }
    }
    this.sqlMode = undefined;
    this.lmEvaluateTarget = undefined;
  }

  async execute(cell: NotebookCell) {
    await this._executeAll([cell], cell.notebook, this._controller);
  }

  private async _executeAll(
    iCells: NotebookCell[],
    notebook: NotebookDocument,
    _controller: NotebookController
  ): Promise<void> {
    log(`${PREFIX} _executeAll START`);
    const config = getNodeConfig();
    await initializeStorageTmpPath(config.tmpDirPath);
    const connectionSettings = await this.stateStorage.getConnectionSettingList();
    const kernel = await NodeKernel.create(connectionSettings);
    let noteSession: NoteSession = {
      executionOrder: 0,
      kernel,
      sqlKernel: undefined,
      awsKernel: undefined,
      cancellationTokenSourceList: [],
      interrupted: false,
    };
    this.noteSessions.set(notebook.uri.path, noteSession);
    this.noteVariables.set(notebook.uri.path, kernel.getStoredVariables());

    const preExecCells = notebook.getCells().filter((it) => isPreExecution(it));

    const targetCells = preExecCells;
    targetCells.push(...iCells.filter((it) => !isPreExecution(it)));

    for (let cell of targetCells) {
      if (noteSession.interrupted) {
        break;
      }
      await this._doExecution(notebook, cell, noteSession);
      const tmp = this.getNoteSession(notebook);
      if (tmp) {
        noteSession = tmp;
      }
    }
    this.noteVariables.set(notebook.uri.path, kernel.getStoredVariables());
    await noteSession.kernel!.dispose();
    noteSession.kernel = undefined;
    this.noteSessions.delete(notebook.uri.path);

    // log(`${PREFIX} _executeAll END`);
  }

  private async _doExecution(
    notebook: NotebookDocument,
    cell: NotebookCell,
    noteSession: NoteSession
  ): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    noteSession.executionOrder++;
    execution.executionOrder = noteSession.executionOrder;
    execution.start(Date.now());

    const outputs: NotebookCellOutput[] = [];
    let success = true;
    let stdout = "";
    let stderr = "";
    let skipped = false;
    let evaluated = false;
    let status = "skipped";
    let metadata: RunResultMetadata | undefined = undefined;
    const cellMeta: CellMeta = cell.metadata;

    try {
      log(`${PREFIX} _executeAll before run`);
      const r = await this.run(notebook, cell);
      log(`${PREFIX} _executeAll after run`);
      stdout = r.stdout;
      stderr = r.stderr;
      skipped = r.skipped;
      evaluated = r.evaluated || false;
      status = r.status;
      metadata = {
        ...r.metadata,
        status,
      };

      if (stdout.length) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.text(stdout)], metadata));
      }
      if (stderr) {
        outputs.push(new NotebookCellOutput([NotebookCellOutputItem.stderr(stderr)], metadata));
        success = false;
      }
      if (skipped && !evaluated) {
        outputs.push(
          new NotebookCellOutput(
            [NotebookCellOutputItem.text("### `SKIPPED!`", "text/markdown")],
            metadata
          )
        );
      }

      if (metadata) {
        const { rdh, explainRdh, analyzedRdh, axiosEvent, updateJSONCellValues, lmResult } =
          metadata;

        if (rdh) {
          const toMarkdownConfig = getToStringParamByConfig({
            maxPrintLines: getResultsetConfig().maxRowsInPreview,
            maxCellValueLength: getResultsetConfig().maxCharactersInCell,
            withCodeLabel: (cellMeta?.codeResolverFile ?? "").length > 0,
            withRuleViolation: (cellMeta?.ruleFile ?? "").length > 0,
          });
          outputs.push(
            new NotebookCellOutput(
              [
                NotebookCellOutputItem.text(
                  `\`[Query Result]\` ${rdh.summary?.info}\n` +
                    ResultSetDataBuilder.from(rdh).toMarkdown(toMarkdownConfig),
                  "text/markdown"
                ),
              ],
              metadata
            )
          );
          if (cellMeta && cellMeta.chart) {
            const commandParam: ChartsViewParams = { ...cellMeta.chart, rdh };
            commands.executeCommand(OPEN_CHARTS_VIEWER, commandParam);
          }
        }

        if (explainRdh) {
          const md = ResultSetDataBuilder.from(explainRdh).toMarkdown(
            getToStringParamByConfig({
              maxPrintLines: getResultsetConfig().maxRowsInPreview,
              maxCellValueLength: getResultsetConfig().maxCharactersInCell,
              withComment: true,
              withRowNo: false,
            })
          );

          outputs.push(
            new NotebookCellOutput(
              [NotebookCellOutputItem.text(`\`[Explain plan]\`\n${md}`, "text/markdown")],
              metadata
            )
          );
        }
        if (analyzedRdh) {
          const md = ResultSetDataBuilder.from(analyzedRdh).toMarkdown(
            getToStringParamByConfig({
              maxPrintLines: getResultsetConfig().maxRowsInPreview,
              maxCellValueLength: getResultsetConfig().maxCharactersInCell,
              withComment: false,
              withRowNo: false,
            })
          );

          outputs.push(
            new NotebookCellOutput(
              [NotebookCellOutputItem.text(`\`[Explain analyze]\`\n${md}`, "text/markdown")],
              metadata
            )
          );
        }
        if (axiosEvent) {
          outputs.push(
            new NotebookCellOutput(
              [
                NotebookCellOutputItem.text(
                  createResponseBodyMarkdown(axiosEvent),
                  "text/markdown"
                ),
              ],
              metadata
            )
          );
        }

        if (lmResult && lmResult.markdownText) {
          outputs.push(
            new NotebookCellOutput(
              [NotebookCellOutputItem.text(lmResult.markdownText, "text/markdown")],
              metadata
            )
          );
        }

        if (updateJSONCellValues) {
          for (const updateJsonCell of updateJSONCellValues) {
            const { cellIndex, replaceAll, data } = updateJsonCell;
            const jsonCells = notebook.getCells().filter((it) => isJsonCell(it));
            if (cellIndex < jsonCells.length) {
              const jsonCell = jsonCells[cellIndex];
              const doc = jsonCell.document;
              const st = doc.positionAt(0);
              const ed = doc.positionAt(doc.getText().length);
              const range = new Range(st, ed);

              let edit;
              if (replaceAll) {
                edit = new TextEdit(range, JSON.stringify(data, null, 2));
              } else {
                const jsonObj = JSON.parse(doc.getText());
                Object.keys(data).forEach((key) => {
                  jsonObj[key] = data[key];
                });
                edit = new TextEdit(range, JSON.stringify(jsonObj, null, 2));
              }

              var formatEdit = new WorkspaceEdit();
              formatEdit.set(doc.uri, [edit]);
              await workspace.applyEdit(formatEdit);
            } else {
              throw new Error(`JSON cell index[${cellIndex}] is out of range[${jsonCells.length}]`);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      logError(`${PREFIX} catch:` + err);

      success = false;
      if (err instanceof Error) {
        stderr = err.message;
        outputs.push(
          new NotebookCellOutput([NotebookCellOutputItem.stdout(err.message)], metadata)
        );
      } else {
        outputs.push(
          new NotebookCellOutput(
            [NotebookCellOutputItem.error(new Error("Error:" + err))],
            metadata
          )
        );
      }
    }
    await execution.replaceOutput(outputs);
    execution.end(success, Date.now());

    if (noteSession.kernel && cellMeta.savingSharedVariables && cellMeta.sharedVariableName) {
      noteSession.kernel.updateVariable(cellMeta.sharedVariableName, {
        success,
        stdout,
        stderr,
        skipped,
        status,
        metadata,
      });
    }
  }

  private async run(notebook: NotebookDocument, cell: NotebookCell): Promise<RunResult> {
    if ((cell.metadata as CellMeta)?.markAsSkip === true) {
      return {
        stdout: "",
        stderr: "",
        skipped: true,
        status: "skipped",
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
      const r = await noteSession.sqlKernel.run(
        cell,
        noteSession.kernel.getStoredVariables(),
        this.sqlMode ?? "Query"
      );
      this.sqlMode = undefined;
      noteSession.sqlKernel = undefined;
      const metadata: CellMeta = cell.metadata;
      if (r.metadata?.rdh?.meta?.type === "select") {
        const { rdh } = r.metadata;
        if (metadata.ruleFile && (await existsFileOnWorkspace(metadata.ruleFile))) {
          const rrule = await readRuleFile(metadata, rdh);
          if (rrule) {
            rdh.meta.tableRule = rrule.tableRule;
            // log(`${PREFIX} rrule.tableRule:${JSON.stringify(rrule.tableRule, null, 1)}`);
            try {
              const runRuleEngineResult = await runRuleEngine(rdh);
              // log(`${PREFIX} runRuleEngineResult:${runRuleEngineResult}`);
            } catch (e) {
              throw new Error(
                `RuleEngineError:${(e as Error).message}. Unuse or review the following file. ${
                  metadata.ruleFile
                }`
              );
            }
          }
        }
        if (metadata.codeResolverFile && (await existsFileOnWorkspace(metadata.codeResolverFile))) {
          const codeResolver = await readCodeResolverFile(metadata);
          if (codeResolver) {
            rdh.meta.codeItems = codeResolver.items;
            const resolveCodeLabelResult = await resolveCodeLabel(rdh);
            // log(`${PREFIX} resolveCodeLabel:${resolveCodeLabelResult}`);
          }
        }
      }

      if (r.metadata?.rdh && metadata.connectionName) {
        await this.stateStorage.addSQLHistory({
          connectionName: metadata.connectionName,
          sqlDoc: cell.document.getText(),
          variables: noteSession.kernel.getStoredVariables(),
          meta: r.metadata?.rdh.meta,
          summary: r.metadata?.rdh.summary,
          codeResolverFile: metadata.codeResolverFile,
          ruleFile: metadata.ruleFile,
        });
        commands.executeCommand(REFRESH_SQL_HISTORIES);
      }

      if (this.lmEvaluateTarget && r.metadata) {
        await runLm(this.stateStorage, cell, r.metadata, noteSession.cancellationTokenSourceList);
        r.evaluated = true;
      }
      this.lmEvaluateTarget = undefined;

      return r;
    } else if (isCwqlCell(cell)) {
      noteSession.awsKernel = new AwsKernel(this.stateStorage);
      const r = await noteSession.awsKernel.run(cell, noteSession.kernel.getStoredVariables());
      noteSession.awsKernel = undefined;
      return r;
    } else if (isJsonCell(cell)) {
      return await jsonKernelRun(cell, noteSession.kernel);
    }

    return noteSession.kernel!.run(cell);
  }
}

// --- status bar
class CellMetadataProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (!isSqlCell(cell)) {
      return undefined;
    }

    const {
      ruleFile,
      codeResolverFile,
      savingSharedVariables,
      sharedVariableName,
      useDatabaseName,
      chart,
    }: CellMeta = cell.metadata;
    let tooltip = "";

    tooltip = "$(gear) Show metadata";

    if (codeResolverFile) {
      let displayFileName = codeResolverFile;
      if (displayFileName.endsWith(".cresolver")) {
        displayFileName = displayFileName.substring(0, displayFileName.length - 10);
      }
      if (await existsFileOnWorkspace(codeResolverFile)) {
        tooltip += " $(replace) Use " + abbr(displayFileName, 18);
      } else {
        tooltip += " $(warning) Missing Code resolver " + abbr(displayFileName, 18);
      }
    }

    if (ruleFile) {
      let displayFileName = ruleFile;
      if (displayFileName.endsWith(".rrule")) {
        displayFileName = displayFileName.substring(0, displayFileName.length - 6);
      }
      if (await existsFileOnWorkspace(ruleFile)) {
        tooltip += " $(checklist) Use " + abbr(displayFileName, 18);
      } else {
        tooltip += " $(warning) Missing Rule " + abbr(displayFileName, 18);
      }
    }

    if (savingSharedVariables && sharedVariableName) {
      tooltip += " $(symbol-variable) " + abbr(sharedVariableName, 18);
    }

    if (useDatabaseName) {
      tooltip += " $(database) " + abbr(useDatabaseName, 18);
    }

    if (chart && chart.type) {
      switch (chart.type) {
        case "bar":
          tooltip += " $(graph) " + chart.type;
          break;
        case "doughnut":
        case "pie":
          tooltip += " $(pie-chart) " + chart.type;
          break;
        case "line":
          tooltip += " $(graph-line) " + chart.type;
          break;
        case "scatter":
        case "pairPlot":
          tooltip += " $(graph-scatter) " + chart.type;
          break;
        case "radar":
          tooltip += " $(graph) " + chart.type;
          break;
      }
    }

    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SHOW_METADATA_SETTINGS;
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
      tooltip = "Mark cell as Enabled";
      text = "$(debug-step-over) Skip";
    } else {
      tooltip = "Mark cell as skip";
      text = "$(circle-small-filled) Enabled";
    }
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_MARK_CELL_AS_SKIP;
    item.tooltip = tooltip;
    return item;
  }
}

class ConnectionSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isSqlCell(cell) && !isCwqlCell(cell)) {
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

class LogGroupSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isCwqlCell(cell)) {
      return undefined;
    }

    const { connectionName, logGroupName }: CellMeta = cell.metadata;
    if (!connectionName) {
      return undefined;
    }

    let tooltip = "";
    if (logGroupName) {
      tooltip = "$(list-ordered) Use " + abbr(logGroupName, 40);
    } else {
      tooltip = "$(error) Specify logGroup";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_LOG_GROUP_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

class LogGroupQueryTimeSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isCwqlCell(cell)) {
      return undefined;
    }

    const { logGroupStartTimeOffset }: CellMeta = cell.metadata;

    let tooltip = "";
    if (logGroupStartTimeOffset) {
      tooltip = "$(calendar) " + logGroupStartTimeOffset;
    } else {
      tooltip = "$(error) Specify start time offset";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_LOG_GROUP_START_TIME_OFFSET_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

class RdhProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rMetadata: RunResultMetadata | undefined = cell.outputs[0]?.metadata;
    if (!rMetadata) {
      return;
    }
    const { rdh, explainRdh, analyzedRdh } = rMetadata;
    if (rdh === undefined && explainRdh === undefined && analyzedRdh === undefined) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(table) Open outputs",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_MDH;
    item.tooltip = "Open outputs in panel";
    return item;
  }
}

class HttpResponseProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rMetadata: RunResultMetadata | undefined = cell.outputs[0]?.metadata;
    if (!rMetadata) {
      return;
    }
    const { axiosEvent } = rMetadata;
    if (axiosEvent === undefined) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(table) Open response",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_HTTP_RESPONSE;
    item.tooltip = "Open response in panel";
    return item;
  }
}

class PreExecutionProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isJsonCell(cell)) {
      return undefined;
    }

    const { markAsRunInOrderAtJsonCell }: CellMeta = cell.metadata;
    let tooltip = "";
    let text = "";
    if (markAsRunInOrderAtJsonCell === true) {
      tooltip = "Mark as 'Run in order'";
      text = "$(circle-small) Run in order";
    } else {
      tooltip = "Mark as 'Pre execution'";
      text = "$(debug-step-into) Pre-execution";
    }
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_MARK_CELL_AS_PRE_EXECUTION;
    item.tooltip = tooltip;
    return item;
  }
}

export const resetCellContext = (cell: NotebookCell) => {
  const meta = cell.metadata as CellMeta;
  if (!meta) {
    return;
  }

  commands.executeCommand("setContext", "cellMetaConnectionName", meta.connectionName ?? "");
};
