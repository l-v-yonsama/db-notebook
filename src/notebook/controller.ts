import { DBType, runRuleEngine } from "@l-v-yonsama/multi-platform-database-drivers";
import { resolveCodeLabel, ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import {
  CancellationTokenSource,
  commands,
  ExtensionContext,
  NotebookCell,
  NotebookCellOutput,
  NotebookCellOutputItem,
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
import { NOTEBOOK_TYPE, OPEN_CHARTS_VIEWER, REFRESH_SQL_HISTORIES } from "../constant";
import type {
  JSONCellValues,
  MqttPublishResult,
  NodeRunAxiosEvent,
  RunResultMetadata,
} from "../shared/RunResultMetadata";
import { CellMeta, LMEvaluateTarget, RunResult, SQLMode } from "../types/Notebook";
import { ChartsViewParams } from "../types/views";
import {
  getNodeConfig,
  getResultsetConfig,
  getToStringParamByConfig,
} from "../utilities/configUtil";
import { existsFileOnWorkspace, initializeStorageTmpPath } from "../utilities/fsUtil";
import {
  createMqttPublishResultMarkdownText,
  createResponseBodyMarkdown,
} from "../utilities/httpUtil";
import { runLm } from "../utilities/lmUtil";
import { log, logError } from "../utilities/logger";
import {
  hasAnyRdhOutputCell,
  isCwqlCell,
  isJsonValueCell,
  isMemcachedCell,
  isMqttCell,
  isPreExecution,
  isSqlCell,
  readCodeResolverFile,
  readRuleFile,
} from "../utilities/notebookUtil";
import { StateStorage } from "../utilities/StateStorage";
import { AwsKernel } from "./awsKernel";
import { jsonKernelRun } from "./JsonKernel";
import { MemcachedKernel } from "./MemcachedKernel";
import { MqttKernel } from "./MqttKernel";
import { NodeKernel } from "./NodeKernel";
import { SqlKernel } from "./sqlKernel";
import {
  CellMetadataProvider,
  ConnectionSettingProvider,
  HttpResponseProvider,
  LogGroupQueryTimeSettingProvider,
  LogGroupSettingProvider,
  MarkCellAsMqttProvider,
  MarkCellAsSkipProvider,
  MqttQosProvider,
  MqttRetainProvider,
  MqttSubscribeExpandJsonColumnProvider,
  MqttTopicProvider,
  PreExecutionProvider,
  RdhProvider,
} from "./statusBarProviders";

const PREFIX = "[notebook/Controller]";

type NoteSession = {
  executionOrder: number;
  kernel: NodeKernel | undefined;
  sqlKernel: SqlKernel | undefined;
  awsKernel: AwsKernel | undefined;
  memcachedKernel: MemcachedKernel | undefined;
  mqttKernel: MqttKernel | undefined;
  cancellationTokenSourceList: CancellationTokenSource[] | undefined;
  interrupted: boolean;
};

export class MainController {
  readonly controllerId = `${NOTEBOOK_TYPE}-controller`;
  readonly notebookType = NOTEBOOK_TYPE;
  readonly label = "Database Notebook";
  readonly supportedLanguages = [
    "sql",
    "javascript",
    "typescript",
    "json",
    "cwql",
    "memcached",
    "plaintext",
  ];

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
                resetCellContext(cell);
              }
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
        new MarkCellAsMqttProvider(stateStorage)
      )
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new MqttTopicProvider())
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new MqttQosProvider(stateStorage)
      )
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, new MqttRetainProvider())
    );
    context.subscriptions.push(
      notebooks.registerNotebookCellStatusBarItemProvider(
        NOTEBOOK_TYPE,
        new MqttSubscribeExpandJsonColumnProvider(stateStorage)
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
    window.setStatusBarMessage("Interrupted", 3000);

    // log(`${PREFIX} interruptHandler`);
    const noteSession = this.getNoteSession(notebook);
    if (noteSession) {
      const {
        kernel,
        sqlKernel,
        awsKernel,
        memcachedKernel,
        mqttKernel,
        cancellationTokenSourceList,
      } = noteSession;
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
        if (memcachedKernel) {
          memcachedKernel.interrupt();
        }
        if (mqttKernel) {
          mqttKernel.interrupt();
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
    const startTime = Date.now();
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
      memcachedKernel: undefined,
      mqttKernel: undefined,
      cancellationTokenSourceList: [],
      interrupted: false,
    };
    this.noteSessions.set(notebook.uri.path, noteSession);
    this.noteVariables.set(notebook.uri.path, kernel.getStoredVariables());

    const preExecCells = notebook.getCells().filter((it) => isPreExecution(it));

    const targetCells = preExecCells;
    targetCells.push(...iCells.filter((it) => !isPreExecution(it)));

    for (let cellIndex = 0; cellIndex < targetCells.length; cellIndex++) {
      const cell = targetCells[cellIndex];
      // リアルタイム表示
      window.setStatusBarMessage(
        `Executing (${cellIndex + 1}/${targetCells.length})`,
        0 // 消えない
      );
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

    if (targetCells.length > 1) {
      let message = "Interrupted";
      if (!noteSession.interrupted) {
        message = `Executed ${targetCells.length} cells in ${
          (Date.now() - startTime) / 1000
        } seconds.`;
      }
      window.setStatusBarMessage(message, 2000);
    }
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
        const {
          rdh,
          explainRdh,
          analyzedRdh,
          axiosEvent,
          mqttPublishResult,
          updateJSONCellValues,
          lmResult,
        } = metadata;

        if (rdh) {
          outputs.push(this.buildRdhOutput(rdh, cell, cellMeta, metadata));
          this.notifyChartsViewerIfNeeded(rdh, cellMeta);
        }
        if (explainRdh) {
          outputs.push(this.buildExplainRdhOutput(explainRdh, metadata));
        }
        if (analyzedRdh) {
          outputs.push(this.buildAnalyzedRdhOutput(analyzedRdh, metadata));
        }
        if (axiosEvent) {
          outputs.push(this.buildAxiosEventOutput(axiosEvent, metadata));
        }
        if (mqttPublishResult) {
          outputs.push(this.buildMqttPublishResultOutput(mqttPublishResult, metadata));
        }
        if (lmResult && lmResult.markdownText) {
          outputs.push(this.buildLmResultOutput(lmResult.markdownText, metadata));
        }
        if (updateJSONCellValues) {
          await this.applyJsonCellValueUpdates(notebook, updateJSONCellValues);
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

  private buildRdhOutput(
    rdh: ResultSetData,
    cell: NotebookCell,
    cellMeta: CellMeta,
    metadata: RunResultMetadata
  ): NotebookCellOutput {
    rdh.meta["languageId"] = cell.document.languageId;
    const toMarkdownConfig = getToStringParamByConfig({
      maxPrintLines: getResultsetConfig().maxRowsInPreview,
      maxCellValueLength: getResultsetConfig().maxCharactersInCell,
      withCodeLabel: (cellMeta?.codeResolverFile ?? "").length > 0,
      withRuleViolation: (cellMeta?.ruleFile ?? "").length > 0,
    });
    const title = rdh.meta.command ? "Command Result" : "Query Result";
    return new NotebookCellOutput(
      [
        NotebookCellOutputItem.text(
          `\`[${title}]\` ${rdh.summary?.info}\n` +
            ResultSetDataBuilder.from(rdh).toMarkdown(toMarkdownConfig),
          "text/markdown"
        ),
      ],
      metadata
    );
  }

  private notifyChartsViewerIfNeeded(rdh: ResultSetData, cellMeta: CellMeta): void {
    if (cellMeta && cellMeta.chart) {
      const commandParam: ChartsViewParams = { ...cellMeta.chart, rdh };
      commands.executeCommand(OPEN_CHARTS_VIEWER, commandParam);
    }
  }

  private buildExplainRdhOutput(
    explainRdh: ResultSetData,
    metadata: RunResultMetadata
  ): NotebookCellOutput {
    const md = ResultSetDataBuilder.from(explainRdh).toMarkdown(
      getToStringParamByConfig({
        maxPrintLines: getResultsetConfig().maxRowsInPreview,
        maxCellValueLength: getResultsetConfig().maxCharactersInCell,
        withComment: true,
        withRowNo: false,
      })
    );
    return new NotebookCellOutput(
      [NotebookCellOutputItem.text(`\`[Explain plan]\`\n${md}`, "text/markdown")],
      metadata
    );
  }

  private buildAnalyzedRdhOutput(
    analyzedRdh: ResultSetData,
    metadata: RunResultMetadata
  ): NotebookCellOutput {
    const md = ResultSetDataBuilder.from(analyzedRdh).toMarkdown(
      getToStringParamByConfig({
        maxPrintLines: getResultsetConfig().maxRowsInPreview,
        maxCellValueLength: getResultsetConfig().maxCharactersInCell,
        withComment: false,
        withRowNo: false,
      })
    );
    return new NotebookCellOutput(
      [NotebookCellOutputItem.text(`\`[Explain analyze]\`\n${md}`, "text/markdown")],
      metadata
    );
  }

  private buildAxiosEventOutput(
    axiosEvent: NodeRunAxiosEvent,
    metadata: RunResultMetadata
  ): NotebookCellOutput {
    return new NotebookCellOutput(
      [NotebookCellOutputItem.text(createResponseBodyMarkdown(axiosEvent), "text/markdown")],
      metadata
    );
  }

  private buildMqttPublishResultOutput(
    mqttPublishResult: MqttPublishResult,
    metadata: RunResultMetadata
  ): NotebookCellOutput {
    return new NotebookCellOutput(
      [
        NotebookCellOutputItem.text(
          createMqttPublishResultMarkdownText(mqttPublishResult),
          "text/markdown"
        ),
      ],
      metadata
    );
  }

  private buildLmResultOutput(
    markdownText: string,
    metadata: RunResultMetadata
  ): NotebookCellOutput {
    return new NotebookCellOutput(
      [NotebookCellOutputItem.text(markdownText, "text/markdown")],
      metadata
    );
  }

  private async applyJsonCellValueUpdates(
    notebook: NotebookDocument,
    updateJSONCellValues: JSONCellValues[]
  ): Promise<void> {
    for (const updateJsonCell of updateJSONCellValues) {
      const { cellIndex, replaceAll, data } = updateJsonCell;
      const jsonCells = notebook.getCells().filter((it) => isJsonValueCell(it));
      if (cellIndex >= jsonCells.length) {
        throw new Error(`JSON cell index[${cellIndex}] is out of range[${jsonCells.length}]`);
      }
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

      const formatEdit = new WorkspaceEdit();
      formatEdit.set(doc.uri, [edit]);
      await workspace.applyEdit(formatEdit);
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
      if (
        this.stateStorage.getDBTypeByConnectionName(cell.metadata.connectionName) === DBType.Mqtt
      ) {
        noteSession.mqttKernel = new MqttKernel(this.stateStorage);
        const r = await noteSession.mqttKernel.requestSql(
          cell,
          noteSession.kernel.getStoredVariables()
        );
        noteSession.mqttKernel = undefined;
        return r;
      }
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

      const resultRdhForHistory =
        r.metadata?.rdh ?? r.metadata?.explainRdh ?? r.metadata?.analyzedRdh;
      if (metadata.connectionName && (resultRdhForHistory || r.status === "error")) {
        await this.stateStorage.addSQLHistory({
          connectionName: metadata.connectionName,
          sqlDoc: cell.document.getText(),
          variables: noteSession.kernel.getStoredVariables(),
          meta: resultRdhForHistory?.meta,
          summary: resultRdhForHistory?.summary,
          codeResolverFile: metadata.codeResolverFile,
          ruleFile: metadata.ruleFile,
          executedAt: Date.now(),
          status: r.status === "error" ? "error" : "success",
          errorMessage: r.status === "error" ? r.stderr : undefined,
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
    } else if (isMemcachedCell(cell)) {
      noteSession.memcachedKernel = new MemcachedKernel(this.stateStorage);
      const r = await noteSession.memcachedKernel.run(
        cell,
        noteSession.kernel.getStoredVariables()
      );
      noteSession.memcachedKernel = undefined;
      return r;
    } else if (isMqttCell(cell)) {
      noteSession.mqttKernel = new MqttKernel(this.stateStorage);
      const r = await noteSession.mqttKernel.run(cell, noteSession.kernel.getStoredVariables());
      noteSession.mqttKernel = undefined;
      return r;
    } else if (isJsonValueCell(cell)) {
      return await jsonKernelRun(cell, noteSession.kernel);
    }

    return noteSession.kernel!.run(cell);
  }
}

export const resetCellContext = (cell: NotebookCell) => {
  const meta = cell.metadata as CellMeta;
  if (!meta) {
    return;
  }

  commands.executeCommand("setContext", "cellMetaConnectionName", meta.connectionName ?? "");
};
