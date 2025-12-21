import {
  DBType,
  isPartiQLType,
  isRDSType,
  MqttQoS,
  ResourceType,
  separateMultipleQueries,
} from "@l-v-yonsama/multi-platform-database-drivers";
import * as dayjs from "dayjs";
import * as path from "path";
import sqlFormatter from "sql-formatter-plus";
import {
  commands,
  ExtensionContext,
  NotebookCell,
  NotebookCellData,
  NotebookCellKind,
  NotebookData,
  NotebookEdit,
  Range,
  TextEdit,
  Uri,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import {
  CELL_EXECUTE_EXPLAIN,
  CELL_EXECUTE_EXPLAIN_ANALYZE,
  CELL_EXECUTE_QUERY,
  CELL_MARK_CELL_AS_MQTT,
  CELL_MARK_CELL_AS_PRE_EXECUTION,
  CELL_MARK_CELL_AS_SKIP,
  CELL_OPEN_HTTP_RESPONSE,
  CELL_OPEN_MDH,
  CELL_SHOW_METADATA_SETTINGS,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CELL_SPECIFY_LOG_GROUP_START_TIME_OFFSET_TO_USE,
  CELL_SPECIFY_LOG_GROUP_TO_USE,
  CELL_SPECIFY_MQTT_EXPAND_JSON_COLUMN,
  CELL_SPECIFY_MQTT_QOS_TO_USE,
  CELL_SPECIFY_MQTT_RETAIN_TO_USE,
  CELL_SPECIFY_MQTT_TOPIC_TO_USE,
  CELL_TOOLBAR_FORMAT,
  CELL_TOOLBAR_LM,
  CREATE_NEW_NOTEBOOK,
  CREATE_NOTEBOOK_FROM_SQL,
  EXPORT_IN_HTML,
  NOTEBOOK_TYPE,
  OPEN_MDH_VIEWER,
  SHOW_NOTEBOOK_ALL_RDH,
  SHOW_NOTEBOOK_ALL_VARIABLES,
  SPECIFY_CONNECTION_TO_ALL_CELLS,
  SPECIFY_USING_DB_TO_ALL_CELLS,
} from "../constant";
import { HttpEventPanel } from "../panels/HttpEventPanel";
import { LMPromptCreatePanel } from "../panels/LMPromptCreatePanel";
import { NotebookCellMetadataPanel } from "../panels/NotebookCellMetadataPanel";
import { VariablesPanel } from "../panels/VariablesPanel";
import { RunResultMetadata } from "../shared/RunResultMetadata";
import { activateStatusBar } from "../statusBar";
import { CellMeta, NotebookToolbarClickEvent } from "../types/Notebook";
import { MdhViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { getFormatterConfig } from "../utilities/configUtil";
import { readResource } from "../utilities/fsUtil";
import { createHtmlFromNotebook } from "../utilities/htmlGenerator";
import { log } from "../utilities/logger";
import {
  getSelectedCells,
  getToolbarButtonClickedNotebookEditor,
  hasAnyRdhOutputCell,
  isCwqlCell,
  isJsonValueCell,
  isMemcachedCell,
  isMqttCell,
  isSqlCell,
} from "../utilities/notebookUtil";
import { rrmListToRdhList } from "../utilities/rrmUtil";
import { StateStorage } from "../utilities/StateStorage";
import { MainController, resetCellContext } from "./controller";
import { activateIntellisense } from "./intellisense";
import { DBNotebookSerializer } from "./serializer";

const PREFIX = "[notebook/activator]";

export function activateNotebook(context: ExtensionContext, stateStorage: StateStorage) {
  log(`${PREFIX} start activateNotebook.`);
  let controller: MainController;

  activateStatusBar(context);
  activateIntellisense(context, stateStorage);

  context.subscriptions.push(
    workspace.registerNotebookSerializer(NOTEBOOK_TYPE, new DBNotebookSerializer(), {
      transientOutputs: true,
    })
  );

  controller = new MainController(context, stateStorage);
  context.subscriptions.push(controller);

  const registerDisposableCommand = (
    command: string,
    callback: (...args: any[]) => any,
    thisArg?: any
  ) => {
    const disposable = commands.registerCommand(command, callback, thisArg);
    context.subscriptions.push(disposable);
  };

  // Notebook commands
  {
    registerDisposableCommand(CREATE_NEW_NOTEBOOK, async (cells?: NotebookCellData[]) => {
      const newNotebook = await workspace.openNotebookDocument(
        NOTEBOOK_TYPE,
        new NotebookData(cells ?? [])
      );

      window.showNotebookDocument(newNotebook);
    });
    registerDisposableCommand(CREATE_NOTEBOOK_FROM_SQL, async (uri: Uri) => {
      const text = await readResource(uri);
      if (!text) {
        window.showErrorMessage("No text data");
        return;
      }
      const queries = separateMultipleQueries(text);
      if (queries.length === 0) {
        window.showErrorMessage("No query data");
        return;
      }
      const newNotebook = await workspace.openNotebookDocument(
        NOTEBOOK_TYPE,
        new NotebookData(
          queries.map((it) => {
            return new NotebookCellData(NotebookCellKind.Code, it, "sql");
          })
        )
      );

      window.showNotebookDocument(newNotebook);
    });
  }

  // Notebook toolbar commands
  {
    registerDisposableCommand(SHOW_NOTEBOOK_ALL_VARIABLES, async (e: NotebookToolbarClickEvent) => {
      const notebookEditor = getToolbarButtonClickedNotebookEditor(e);

      if (!notebookEditor) {
        return;
      }
      const cells = notebookEditor?.notebook.getCells();
      if (!cells) {
        return;
      }

      const variables = controller.getVariables(notebookEditor.notebook);
      if (!variables) {
        return;
      }
      VariablesPanel.render(context.extensionUri, variables);
    });

    registerDisposableCommand(SHOW_NOTEBOOK_ALL_RDH, async (e: NotebookToolbarClickEvent) => {
      const { notebookUri } = e.notebookEditor;
      const filePath = notebookUri.fsPath ?? "";
      const notebookEditor = getToolbarButtonClickedNotebookEditor(e);

      const cells = notebookEditor?.notebook.getCells();
      if (!cells) {
        return;
      }

      const rrmList = cells
        .filter((it) => hasAnyRdhOutputCell(it))
        .map((it) => it.outputs[0].metadata as RunResultMetadata);
      const title = path.basename(filePath);
      const commandParam: MdhViewParams = { title, list: rrmListToRdhList(rrmList) };
      commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
    });

    registerDisposableCommand(
      SPECIFY_CONNECTION_TO_ALL_CELLS,
      async (e: NotebookToolbarClickEvent) => {
        const notebookEditor = getToolbarButtonClickedNotebookEditor(e);

        const cells = notebookEditor?.notebook.getCells();
        if (!cells) {
          return;
        }
        if (cells.every((it) => !isSqlCell(it))) {
          return;
        }
        const conSettings = await stateStorage.getConnectionSettingList();
        const items = conSettings
          .filter(
            (it) =>
              it.dbType === DBType.Mqtt ||
              isRDSType(it.dbType) ||
              isPartiQLType(it.dbType, it.awsSetting)
          )
          .map((it) => ({
            label: it.name,
            description: it.dbType,
          }));
        items.push({ label: "<None>", description: "(set as unspecified)" as DBType });
        const result = await window.showQuickPick(items);
        if (result) {
          for (const cell of cells) {
            if (!isSqlCell(cell)) {
              continue;
            }
            if (cell.metadata?.connectionName === result.label) {
              continue;
            }
            const metadata: CellMeta = {
              ...cell.metadata,
            };
            if (result.label === "<None>") {
              delete metadata.connectionName;
            } else {
              metadata.connectionName = result.label;
            }
            const edit = new WorkspaceEdit();
            const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
            edit.set(cell.notebook.uri, [nbEdit]);

            await workspace.applyEdit(edit);
          }
        }
      }
    );

    registerDisposableCommand(
      SPECIFY_USING_DB_TO_ALL_CELLS,
      async (e: NotebookToolbarClickEvent) => {
        const notebookEditor = getToolbarButtonClickedNotebookEditor(e);

        const cells = notebookEditor?.notebook.getCells();
        if (!cells) {
          return;
        }
        if (cells.every((it) => !isSqlCell(it))) {
          return;
        }

        const result = await window.showInputBox({
          title: "Specify if switching to a database",
          placeHolder: "Enter database-name",
          value: "",
        });

        if (result === undefined) {
          return;
        }
        for (const cell of cells) {
          if (!isSqlCell(cell)) {
            continue;
          }
          const { useDatabaseName, connectionName } = cell.metadata as CellMeta;
          if (useDatabaseName === result || connectionName === undefined) {
            continue;
          }
          const dbType = stateStorage.getDBTypeByConnectionName(connectionName);
          if (dbType === undefined) {
            continue;
          }

          const metadata: CellMeta = {
            ...cell.metadata,
            useDatabaseName: result === "" ? undefined : result,
          };
          const edit = new WorkspaceEdit();
          const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
          edit.set(cell.notebook.uri, [nbEdit]);
          await workspace.applyEdit(edit);
        }
      }
    );

    registerDisposableCommand(EXPORT_IN_HTML, async (e: NotebookToolbarClickEvent) => {
      const notebookEditor = getToolbarButtonClickedNotebookEditor(e);
      const cells = notebookEditor?.notebook.getCells();
      if (!cells || !notebookEditor) {
        return;
      }
      const title = path.basename(notebookEditor?.notebook.uri.fsPath);
      const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${title}.html`;
      const previousFolder = await stateStorage.getPreviousSaveFolder();
      const baseUri = previousFolder ? Uri.file(previousFolder) : Uri.file("./");
      const uri = await window.showSaveDialog({
        defaultUri: Uri.joinPath(baseUri, defaultFileName),
        filters: { "*": ["html"] },
      });
      if (!uri) {
        return;
      }
      await stateStorage.setPreviousSaveFolder(path.dirname(uri.fsPath));
      const message = await createHtmlFromNotebook(notebookEditor.notebook, uri.fsPath);
      if (message) {
        showWindowErrorMessage(message);
      } else {
        window.showInformationMessage(uri.fsPath);
      }
    });
  }

  // Notebook cell statusbar commands
  {
    const updateCellMetadata = async (cell: NotebookCell, metadata: CellMeta) => {
      const edit = new WorkspaceEdit();
      const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
      edit.set(cell.notebook.uri, [nbEdit]);

      await workspace.applyEdit(edit);
    };

    registerDisposableCommand(CELL_SPECIFY_CONNECTION_TO_USE, async (cell?: NotebookCell) => {
      let targetCells: NotebookCell[] = [];
      if (cell === null || cell === undefined) {
        targetCells = getSelectedCells({ onlySql: true });
      } else {
        targetCells = [cell];
      }

      const conSettings = await stateStorage.getConnectionSettingList();
      const items = conSettings
        .filter((it) => {
          if (isMqttCell(targetCells[0])) {
            return it.dbType === DBType.Mqtt;
          } else if (isMemcachedCell(targetCells[0])) {
            return it.dbType === DBType.Memcache;
          } else {
            return (
              it.dbType === DBType.Mqtt ||
              isRDSType(it.dbType) ||
              isPartiQLType(it.dbType, it.awsSetting)
            );
          }
        })
        .map((it) => ({
          label: it.name,
          description: it.dbType,
        }));
      items.push({ label: "<None>", description: "(set as unspecified)" as DBType });
      const result = await window.showQuickPick(items);
      if (result) {
        targetCells.forEach(async (cell) => {
          if (cell.metadata?.connectionName === result.label) {
            return;
          }
          const metadata: CellMeta = {
            ...cell.metadata,
          };
          if (result.label === "<None>") {
            delete metadata.connectionName;
          } else {
            metadata.connectionName = result.label;
          }
          await updateCellMetadata(cell, metadata);

          resetCellContext(cell);
        });
      }
    });

    registerDisposableCommand(CELL_MARK_CELL_AS_MQTT, async (cell: NotebookCell) => {
      let tooltip = "";

      const { publishParams }: CellMeta = cell.metadata;
      if (publishParams) {
        if (cell.document.languageId === "json") {
          tooltip = "Mark cell as General JSON";
        } else {
          tooltip = "Mark cell as General Plain text";
        }
      } else {
        if (cell.document.languageId === "json") {
          tooltip = "Mark cell as MQTT";
        } else {
          tooltip = "Mark cell as MQTT";
        }
      }
      const answer = await window.showInformationMessage(
        `Are you sure to ${tooltip}?`,
        "YES",
        "NO"
      );
      if (answer !== "YES") {
        return;
      }

      const metadata: CellMeta = {
        ...cell.metadata,
      };
      if (metadata.publishParams) {
        delete metadata.publishParams;
      } else {
        metadata.publishParams = {
          qos: 0,
          retain: false,
          topicName: "",
        };
      }
      await updateCellMetadata(cell, metadata);
    });

    registerDisposableCommand(CELL_SPECIFY_MQTT_TOPIC_TO_USE, async (cell: NotebookCell) => {
      const { publishParams }: CellMeta = cell.metadata;
      if (!publishParams) {
        return;
      }

      const result = await window.showInputBox({
        title: "Specify topic name",
        placeHolder: "Enter topic name(e.g. sensor/temp)",
        prompt:
          "Spaces, control characters, consecutive slashes, '+', and '#' are not allowed in subscription topic names.",
        value: "",
        validateInput: (input: string): string | undefined => {
          if (!input || input.trim() === "") {
            return "Topic name must not be empty!";
          }
          if (input.includes(" ")) {
            return "Topic name must not contain spaces!";
          }
          if (/[\u0000-\u001F\u007F]/.test(input)) {
            return "Topic name must not contain control characters!";
          }
          if (input.includes("//")) {
            return "Topic name must not contain consecutive slashes!";
          }
          if (input.includes("+") || input.includes("#")) {
            return "Topic name must not contain '+' or '#'.";
          }
          return undefined;
        },
      });

      if (result === undefined) {
        return;
      }
      if (result) {
        if (publishParams.topicName === result) {
          return;
        }
        const metadata: CellMeta = {
          ...cell.metadata,
        };

        metadata.publishParams!.topicName = result;

        await updateCellMetadata(cell, metadata);
      }
    });

    registerDisposableCommand(CELL_SPECIFY_MQTT_QOS_TO_USE, async (cell: NotebookCell) => {
      const { publishParams }: CellMeta = cell.metadata;
      if (!publishParams) {
        return;
      }

      const items = [
        { label: "0", description: "(at most once)" },
        { label: "1", description: "(at least once)" },
        { label: "2", description: "(exactoly once)" },
      ];
      const result = await window.showQuickPick(items);
      if (result) {
        const resultQos = Number(result.label) as MqttQoS;
        if (publishParams?.qos === resultQos) {
          return;
        }
        const metadata: CellMeta = {
          ...cell.metadata,
        };

        metadata.publishParams!.qos = resultQos;

        await updateCellMetadata(cell, metadata);
      }
    });

    registerDisposableCommand(CELL_SPECIFY_MQTT_RETAIN_TO_USE, async (cell: NotebookCell) => {
      const { publishParams }: CellMeta = cell.metadata;
      if (!publishParams) {
        return;
      }

      publishParams.retain = !publishParams.retain;
      const metadata: CellMeta = {
        ...cell.metadata,
      };

      await updateCellMetadata(cell, metadata);
    });

    registerDisposableCommand(CELL_SPECIFY_MQTT_EXPAND_JSON_COLUMN, async (cell: NotebookCell) => {
      let { subscribeParams }: CellMeta = cell.metadata;
      if (!subscribeParams) {
        subscribeParams = {
          expandJsonColumn: false,
        };
      }

      subscribeParams.expandJsonColumn = !subscribeParams.expandJsonColumn;
      const metadata: CellMeta = {
        ...cell.metadata,
        subscribeParams,
      };

      await updateCellMetadata(cell, metadata);
    });

    registerDisposableCommand(CELL_SPECIFY_LOG_GROUP_TO_USE, async (cell: NotebookCell) => {
      const { connectionName }: CellMeta = cell.metadata;
      if (connectionName === undefined) {
        return;
      }
      const conSettings = await stateStorage.getConnectionSettingByName(connectionName);
      if (conSettings === undefined || conSettings.dbType !== DBType.Aws) {
        return;
      }
      const cw = stateStorage.getCloudwatchDatabase(connectionName);
      if (!cw) {
        return;
      }

      const items = (cw?.children || [])
        ?.filter((it) => it.resourceType === ResourceType.LogGroup)
        .map((it) => ({
          label: it.name,
          description: `(storedBytes:${it.getProperties().storedBytes})`,
        }));
      items.push({ label: "<None>", description: "(set as unspecified)" });
      const result = await window.showQuickPick(items);
      if (result) {
        if (cell.metadata?.logGroupName === result.label) {
          return;
        }
        const metadata: CellMeta = {
          ...cell.metadata,
        };
        if (result.label === "<None>") {
          delete metadata.logGroupName;
        } else {
          metadata.logGroupName = result.label;
        }
        await updateCellMetadata(cell, metadata);
      }
    });

    registerDisposableCommand(
      CELL_SPECIFY_LOG_GROUP_START_TIME_OFFSET_TO_USE,
      async (cell: NotebookCell) => {
        if (!isCwqlCell(cell)) {
          return undefined;
        }

        const items = [
          {
            label: "1m",
            description: "1 minute",
          },
          {
            label: "5m",
            description: "5 minutes",
          },
          {
            label: "15m",
            description: "15 minutes",
          },
          {
            label: "30m",
            description: "30 minutes",
          },
          {
            label: "1h",
            description: "1 hour",
          },
          {
            label: "6h",
            description: "6 hours",
          },
          {
            label: "12h",
            description: "12 hours",
          },
          {
            label: "1d",
            description: "1 day",
          },
          {
            label: "1w",
            description: "1 week",
          },
        ];
        items.push({ label: "<None>", description: "(set as unspecified)" });
        const result = await window.showQuickPick(items);
        if (result) {
          if (cell.metadata?.logGroupStartTimeOffset === result.label) {
            return;
          }
          const metadata: CellMeta = {
            ...cell.metadata,
          };
          if (result.label === "<None>") {
            delete metadata.logGroupStartTimeOffset;
          } else {
            metadata.logGroupStartTimeOffset = result.label as any;
          }
          await updateCellMetadata(cell, metadata);
        }
      }
    );

    registerDisposableCommand(CELL_OPEN_MDH, async (cell: NotebookCell) => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath;
      const rrm: RunResultMetadata | undefined = cell.outputs?.[0].metadata;
      if (
        rrm === undefined ||
        (rrm.rdh === undefined && rrm.explainRdh === undefined && rrm.analyzedRdh === undefined)
      ) {
        return;
      }

      const title = filePath ? path.basename(filePath) : rrm.tableName ?? "CELL" + cell.index;
      const commandParam: MdhViewParams = {
        title,
        list: rrmListToRdhList([rrm]),
      };
      commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
    });

    registerDisposableCommand(CELL_OPEN_HTTP_RESPONSE, async (cell: NotebookCell) => {
      const rrm: RunResultMetadata | undefined = cell.outputs?.[0].metadata;
      if (rrm === undefined || rrm.axiosEvent === undefined) {
        return;
      }

      const title = rrm.axiosEvent.title;
      HttpEventPanel.render(context.extensionUri, title, rrm.axiosEvent);
    });
    registerDisposableCommand(CELL_MARK_CELL_AS_SKIP, async (cell?: NotebookCell) => {
      let targetCells: NotebookCell[] = [];
      if (cell === null || cell === undefined) {
        targetCells = getSelectedCells({ onlyCode: true });
      } else {
        targetCells = [cell];
      }

      targetCells.forEach((cell) => {
        const metadata: CellMeta = {
          ...cell.metadata,
        };
        if (metadata.markAsSkip === true) {
          metadata.markAsSkip = false;
        } else {
          metadata.markAsSkip = true;
        }
        updateCellMetadata(cell, metadata);
      });
    });
    registerDisposableCommand(CELL_MARK_CELL_AS_PRE_EXECUTION, async (cell: NotebookCell) => {
      const metadata: CellMeta = {
        ...cell.metadata,
      };
      if (metadata.markAsRunInOrderAtJsonCell === true) {
        metadata.markAsRunInOrderAtJsonCell = false;
      } else {
        metadata.markAsRunInOrderAtJsonCell = true;
      }
      await updateCellMetadata(cell, metadata);
    });

    registerDisposableCommand(CELL_SHOW_METADATA_SETTINGS, async (cell: NotebookCell) => {
      NotebookCellMetadataPanel.render(context.extensionUri, cell);
    });
  }

  // Notebook cell-toolbar commands
  {
    registerDisposableCommand(CELL_TOOLBAR_LM, async (cell: NotebookCell) => {
      LMPromptCreatePanel.setMainController(controller);
      LMPromptCreatePanel.render(context.extensionUri, cell);
    });
  }
  {
    registerDisposableCommand(CELL_TOOLBAR_FORMAT, async (cell: NotebookCell) => {
      const doc = cell.document;
      const st = doc.positionAt(0);
      const ed = doc.positionAt(doc.getText().length);
      const range = new Range(st, ed);
      let edit: TextEdit;

      if (isSqlCell(cell)) {
        edit = new TextEdit(range, sqlFormatter.format(doc.getText(), getFormatterConfig()));
      } else if (isJsonValueCell(cell)) {
        const jsonObj = JSON.parse(doc.getText());
        edit = new TextEdit(range, JSON.stringify(jsonObj, null, 2));
      } else if (isMqttCell(cell)) {
        if (doc.languageId === "json") {
          const jsonObj = JSON.parse(doc.getText());
          edit = new TextEdit(range, JSON.stringify(jsonObj, null, 2));
        } else {
          return;
        }
      } else {
        return;
      }
      var formatEdit = new WorkspaceEdit();
      formatEdit.set(doc.uri, [edit]);
      await workspace.applyEdit(formatEdit);
    });
  }

  // NOTEBOOK CELL EXECUTE
  {
    registerDisposableCommand(CELL_EXECUTE_QUERY, async (cell: NotebookCell) => {
      controller.setSqlMode("Query");
      // Perform command issuance to activate the interrupt button.
      commands.executeCommand("notebook.cell.execute", {
        ranges: [{ start: cell.index, end: cell.index + 1 }],
        document: cell.notebook.uri,
      });
    });
    registerDisposableCommand(CELL_EXECUTE_EXPLAIN, async (cell: NotebookCell) => {
      controller.setSqlMode("Explain");
      // Perform command issuance to activate the interrupt button.
      commands.executeCommand("notebook.cell.execute", {
        ranges: [{ start: cell.index, end: cell.index + 1 }],
        document: cell.notebook.uri,
      });
    });
    registerDisposableCommand(CELL_EXECUTE_EXPLAIN_ANALYZE, async (cell: NotebookCell) => {
      controller.setSqlMode("ExplainAnalyze");
      // Perform command issuance to activate the interrupt button.
      commands.executeCommand("notebook.cell.execute", {
        ranges: [{ start: cell.index, end: cell.index + 1 }],
        document: cell.notebook.uri,
      });
    });
  }

  // NOTEBOOK CELL TITLE (CELL TOOLBAR-ACTION)
  context.subscriptions.push(
    window.onDidChangeNotebookEditorSelection((e) => {
      const cell = e.notebookEditor.notebook.cellAt(e.selections[0]?.start);
      commands.executeCommand("setContext", "cellLangId", cell.document.languageId);
      resetCellContext(cell);
    })
  );

  log(`${PREFIX} end activateNotebook.`);
}
