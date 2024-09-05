import { isRDSType, separateMultipleQueries } from "@l-v-yonsama/multi-platform-database-drivers";
import * as dayjs from "dayjs";
import * as path from "path";
import sqlFormatter from "sql-formatter-plus";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellData,
  NotebookCellKind,
  NotebookData,
  NotebookEdit,
  Range,
  TextEdit,
  Uri,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import {
  CELL_EXECUTE_EXPLAIN,
  CELL_EXECUTE_EXPLAIN_ANALYZE,
  CELL_EXECUTE_QUERY,
  CELL_MARK_CELL_AS_PRE_EXECUTION,
  CELL_MARK_CELL_AS_SKIP,
  CELL_OPEN_HTTP_RESPONSE,
  CELL_OPEN_MDH,
  CELL_SHOW_METADATA_SETTINGS,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CELL_TOOLBAR_FORMAT,
  CREATE_NEW_NOTEBOOK,
  CREATE_NOTEBOOK_FROM_SQL,
  EXPORT_IN_HTML,
  NOTEBOOK_TYPE,
  OPEN_MDH_VIEWER,
  SHOW_NOTEBOOK_ALL_RDH,
  SHOW_NOTEBOOK_ALL_VARIABLES,
  SPECIFY_CONNECTION_TO_ALL_CELLS,
} from "../constant";
import { HttpEventPanel } from "../panels/HttpEventPanel";
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
  isJsonCell,
  isSqlCell,
} from "../utilities/notebookUtil";
import { rrmListToRdhList } from "../utilities/rrmUtil";
import { StateStorage } from "../utilities/StateStorage";
import { MainController } from "./controller";
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
          .filter((it) => isRDSType(it.dbType))
          .map((it) => ({
            label: it.name,
            description: it.dbType,
          }));
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
            metadata.connectionName = result.label;
            const edit = new WorkspaceEdit();
            const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
            edit.set(cell.notebook.uri, [nbEdit]);

            await workspace.applyEdit(edit);
          }
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
    registerDisposableCommand(CELL_SPECIFY_CONNECTION_TO_USE, async (cell?: NotebookCell) => {
      let targetCells: NotebookCell[] = [];
      if (cell === null || cell === undefined) {
        targetCells = getSelectedCells({ onlySql: true });
      } else {
        targetCells = [cell];
      }

      const conSettings = await stateStorage.getConnectionSettingList();
      const items = conSettings
        .filter((it) => isRDSType(it.dbType))
        .map((it) => ({
          label: it.name,
          description: it.dbType,
        }));
      const result = await window.showQuickPick(items);
      if (result) {
        targetCells.forEach((cell) => {
          if (cell.metadata?.connectionName === result.label) {
            return;
          }
          const metadata: CellMeta = {
            ...cell.metadata,
          };
          metadata.connectionName = result.label;
          const edit = new WorkspaceEdit();
          const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
          edit.set(cell.notebook.uri, [nbEdit]);

          workspace.applyEdit(edit);
        });
      }
    });

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
        const edit = new WorkspaceEdit();
        const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
        edit.set(cell.notebook.uri, [nbEdit]);

        workspace.applyEdit(edit);
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
      const edit = new WorkspaceEdit();
      const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
      edit.set(cell.notebook.uri, [nbEdit]);

      await workspace.applyEdit(edit);
    });

    registerDisposableCommand(CELL_SHOW_METADATA_SETTINGS, async (cell: NotebookCell) => {
      NotebookCellMetadataPanel.render(context.extensionUri, cell);
    });
  }

  // Notebook cell-toolbar commands
  {
    registerDisposableCommand(CELL_TOOLBAR_FORMAT, async (cell: NotebookCell) => {
      const doc = cell.document;
      const st = doc.positionAt(0);
      const ed = doc.positionAt(doc.getText().length);
      const range = new Range(st, ed);
      let edit: TextEdit;

      if (isSqlCell(cell)) {
        edit = new TextEdit(range, sqlFormatter.format(doc.getText(), getFormatterConfig()));
      } else if (isJsonCell(cell)) {
        const jsonObj = JSON.parse(doc.getText());
        edit = new TextEdit(range, JSON.stringify(jsonObj, null, 2));
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
    })
  );

  log(`${PREFIX} end activateNotebook.`);
}
