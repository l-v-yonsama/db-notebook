import { DBNotebookSerializer } from "./serializer";
import { MainController } from "./controller";
import { StateStorage } from "../utilities/StateStorage";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellData,
  NotebookData,
  NotebookEdit,
  Range,
  TextEdit,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import { CellMeta, NotebookToolbarClickEvent } from "../types/Notebook";
import { activateIntellisense } from "./intellisense";
import * as path from "path";
import { VariablesPanel } from "../panels/VariablesPanel";
import { activateStatusBar } from "../statusBar";
import {
  CELL_OPEN_MDH,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CELL_SHOW_METADATA_SETTINGS,
  CELL_WRITE_TO_CLIPBOARD,
  CREATE_NEW_NOTEBOOK,
  NOTEBOOK_TYPE,
  SHOW_NOTEBOOK_ALL_RDH,
  SHOW_NOTEBOOK_ALL_VARIABLES,
  SPECIFY_CONNECTION_TO_ALL_CELLS,
  CELL_MARK_CELL_AS_SKIP,
  CELL_OPEN_HTTP_RESPONSE,
  CELL_MARK_CELL_AS_PRE_EXECUTION,
  CELL_TOOLBAR_FORMAT,
  CELL_EXECUTE_QUERY,
  CELL_EXECUTE_EXPLAIN,
  CELL_EXECUTE_EXPLAIN_ANALYZE,
  OPEN_MDH_VIEWER,
} from "../constant";
import {
  getToolbarButtonClickedNotebookEditor,
  isJsonCell,
  hasAnyRdhOutputCell,
  isSqlCell,
} from "../utilities/notebookUtil";
import { WriteToClipboardParamsPanel } from "../panels/WriteToClipboardParamsPanel";
import { log } from "../utilities/logger";
import { NotebookCellMetadataPanel } from "../panels/NotebookCellMetadataPanel";
import { RunResultMetadata } from "../shared/RunResultMetadata";
import { rrmListToRdhList } from "../utilities/rrmUtil";
import { HttpEventPanel } from "../panels/HttpEventPanel";
import sqlFormatter from "sql-formatter-plus";
import { getFormatterConfig } from "../utilities/configUtil";
import { MdhViewParams } from "../types/views";

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
        const items = conSettings.map((it) => ({
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
  }

  // Notebook cell statusbar commands
  {
    registerDisposableCommand(CELL_SPECIFY_CONNECTION_TO_USE, async (cell: NotebookCell) => {
      const conSettings = await stateStorage.getConnectionSettingList();
      const items = conSettings.map((it) => ({
        label: it.name,
        description: it.dbType,
      }));
      const result = await window.showQuickPick(items);
      if (result) {
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

        await workspace.applyEdit(edit);
      }
    });

    registerDisposableCommand(CELL_WRITE_TO_CLIPBOARD, async (cell: NotebookCell) => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath;
      const rrm: RunResultMetadata | undefined = cell.outputs?.[0].metadata;
      if (!isSqlCell(cell) || rrm === undefined) {
        return;
      }
      WriteToClipboardParamsPanel.render(context.extensionUri, rrmListToRdhList([rrm]), {
        tabId: "",
        fileType: "markdown",
        outputWithType: "withComment",
        withRowNo: false,
        withCodeLabel: true,
        specifyDetail: true,
        withRuleViolation: true,
        limit: 10,
      });
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
    registerDisposableCommand(CELL_MARK_CELL_AS_SKIP, async (cell: NotebookCell) => {
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

      await workspace.applyEdit(edit);
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
