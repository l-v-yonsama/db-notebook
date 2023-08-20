import { DBNotebookSerializer } from "./serializer";
import { MainController } from "./controller";
import { MdhPanel } from "../panels/MdhPanel";
import { StateStorage } from "../utilities/StateStorage";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellData,
  NotebookData,
  NotebookEdit,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import { CellMeta } from "../types/Notebook";
import { activateIntellisense } from "./intellisense";
import { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
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
  SHOW_ALL_RDH as SHOW_ALL_SELECT_RDH,
  SHOW_ALL_VARIABLES,
  SPECIFY_CONNECTION_ALL,
  CELL_MARK_CELL_AS_SKIP,
} from "../constant";
import { isSelectOrShowSqlCell, isSqlCell } from "../utilities/notebookUtil";
import { WriteToClipboardParamsPanel } from "../panels/WriteToClipboardParamsPanel";
import { log } from "../utilities/logger";
import { NotebookCellMetadataPanel } from "../panels/NotebookCellMetadataPanel";
import { SQLRunResultMetadata } from "../shared/SQLRunResultMetadata";
import { rrmListToRdhList } from "../utilities/rrmUtil";

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

  // Commands
  context.subscriptions.push(
    commands.registerCommand(CREATE_NEW_NOTEBOOK, async (cells?: NotebookCellData[]) => {
      const newNotebook = await workspace.openNotebookDocument(
        NOTEBOOK_TYPE,
        new NotebookData(cells ?? [])
      );
      window.showNotebookDocument(newNotebook);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(CELL_SPECIFY_CONNECTION_TO_USE, async (cell: NotebookCell) => {
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
    })
  );
  context.subscriptions.push(
    commands.registerCommand(CELL_WRITE_TO_CLIPBOARD, async (cell: NotebookCell) => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath;
      const rrm: SQLRunResultMetadata | undefined = cell.outputs?.[0].metadata;
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
    })
  );
  context.subscriptions.push(
    commands.registerCommand(CELL_OPEN_MDH, async (cell: NotebookCell) => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath;
      const rrm: SQLRunResultMetadata | undefined = cell.outputs?.[0].metadata;
      if (!isSqlCell(cell) || rrm === undefined) {
        return;
      }

      const title = filePath ? path.basename(filePath) : rrm.tableName ?? "CELL" + cell.index;
      MdhPanel.render(context.extensionUri, title, rrmListToRdhList([rrm]));
    })
  );
  context.subscriptions.push(
    commands.registerCommand(SHOW_ALL_VARIABLES, async () => {
      const notebook = window.activeNotebookEditor?.notebook;
      const cells = notebook?.getCells();
      if (!cells) {
        return;
      }

      const variables = controller.getVariables(notebook!);
      if (!variables) {
        return;
      }
      VariablesPanel.render(context.extensionUri, variables);
    })
  );
  context.subscriptions.push(
    commands.registerCommand(SHOW_ALL_SELECT_RDH, async () => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath ?? "";
      const cells = window.activeNotebookEditor?.notebook.getCells();
      if (!cells) {
        return;
      }
      const rdhList: ResultSetData[] = [];
      cells
        .filter((it) => isSelectOrShowSqlCell(it) && it.outputs[0].metadata?.rdh !== undefined)
        .forEach((it) => {
          rdhList.push(it.outputs[0].metadata!.rdh);
        });
      const title = path.basename(filePath);
      MdhPanel.render(context.extensionUri, title, rdhList);
    })
  );
  context.subscriptions.push(
    commands.registerCommand(SPECIFY_CONNECTION_ALL, async () => {
      const cells = window.activeNotebookEditor?.notebook.getCells();
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
    })
  );
  context.subscriptions.push(
    commands.registerCommand(CELL_MARK_CELL_AS_SKIP, async (cell: NotebookCell) => {
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
    })
  );

  context.subscriptions.push(
    commands.registerCommand(CELL_SHOW_METADATA_SETTINGS, async (cell: NotebookCell) => {
      NotebookCellMetadataPanel.render(context.extensionUri, cell);
    })
  );
  log(`${PREFIX} end activateNotebook.`);
}
