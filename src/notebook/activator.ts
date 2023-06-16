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
  CELL_SPECIFY_RULES_TO_USE,
  CELL_TOGGLE_SHOW_COMMENT,
  CELL_WRITE_TO_CLIPBOARD,
  CREATE_NEW_NOTEBOOK,
  NOTEBOOK_TYPE,
  SHOW_ALL_RDH,
  SHOW_ALL_VARIABLES,
  SPECIFY_CONNECTION_ALL,
} from "../constant";
import { isSqlCell } from "../utilities/notebookUtil";
import { WriteToClipboardParamsPanel } from "../panels/WriteToClipboardParamsPanel";
import { log } from "../utilities/logger";

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
        // new NotebookData([new NotebookCellData(NotebookCellKind.Code, "", "rest-book")])
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
      const rdh: ResultSetData = cell.outputs?.[0].metadata?.rdh;
      WriteToClipboardParamsPanel.render(context.extensionUri, [rdh], {
        tabId: "",
        fileType: "markdown",
        outputWithType: "withComment",
        withRowNo: true,
        specifyDetail: true,
        limit: 10,
      });
    })
  );
  context.subscriptions.push(
    commands.registerCommand(CELL_OPEN_MDH, async (cell: NotebookCell) => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath;
      const rdh: ResultSetData = cell.outputs?.[0].metadata?.rdh;
      const title = filePath ? path.basename(filePath) : rdh.meta.tableName ?? "CELL" + cell.index;
      MdhPanel.render(context.extensionUri, title, [rdh]);
    })
  );
  context.subscriptions.push(
    commands.registerCommand(SHOW_ALL_VARIABLES, async () => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath ?? "";
      const cells = window.activeNotebookEditor?.notebook.getCells();
      if (!cells) {
        return;
      }
      const variables = controller.getVariables();
      if (!variables) {
        return;
      }
      VariablesPanel.render(context.extensionUri, variables);
    })
  );
  context.subscriptions.push(
    commands.registerCommand(SHOW_ALL_RDH, async () => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath ?? "";
      const cells = window.activeNotebookEditor?.notebook.getCells();
      if (!cells) {
        return;
      }
      const rdhList = cells
        .filter((it) => isSqlCell(it) && it.outputs.length > 0 && it.outputs[0].metadata?.rdh)
        .map((it) => it.outputs[0].metadata?.rdh);
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
    commands.registerCommand(CELL_SPECIFY_RULES_TO_USE, async (cell: NotebookCell) => {
      let wsfolder = workspace.workspaceFolders?.[0].uri;
      if (!wsfolder) {
        return;
      }
      const rootPath = wsfolder.fsPath;

      const files = await workspace.findFiles("**/*.rrule", "**/node_modules/**");
      if (files.length === 0) {
        window.showErrorMessage('No "Reocrd rule files" on your workspace');
        return;
      }

      const items: { label: string; description: string | undefined }[] = files.map((it) => ({
        label: path.relative(rootPath, it.fsPath),
        description: undefined,
      }));
      const NO_USE = "No use";
      items.unshift({
        label: NO_USE,
        description: "Stop using rules",
      });
      const result = await window.showQuickPick(items);
      if (result) {
        if (cell.metadata?.ruleFile === result.label) {
          return;
        }
        const metadata: CellMeta = {
          ...cell.metadata,
        };
        if (result.label === NO_USE) {
          metadata.ruleFile = "";
        } else {
          metadata.ruleFile = result.label;
        }
        const edit = new WorkspaceEdit();
        const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
        edit.set(cell.notebook.uri, [nbEdit]);

        await workspace.applyEdit(edit);
      }
    })
  );
  context.subscriptions.push(
    commands.registerCommand(CELL_TOGGLE_SHOW_COMMENT, async (cell: NotebookCell) => {
      const showComment = cell?.metadata?.showComment === true;
      const metadata: CellMeta = {
        ...cell.metadata,
        showComment: !showComment,
      };
      const edit = new WorkspaceEdit();
      const nbEdit = NotebookEdit.updateCellMetadata(cell.index, metadata);
      edit.set(cell.notebook.uri, [nbEdit]);

      await workspace.applyEdit(edit);
    })
  );
  log(`${PREFIX} end activateNotebook.`);
}
