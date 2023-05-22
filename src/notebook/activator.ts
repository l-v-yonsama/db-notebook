import { DBNotebookSerializer } from "./serializer";
import { MainController } from "./controller";
import { MdhPanel } from "../panels/MdhPanel";
import { StateStorage } from "../utilities/StateStorage";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellData,
  NotebookCellKind,
  NotebookData,
  NotebookEdit,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import { CellMeta } from "../types/Notebook";
import { activateIntellisense } from "./intellisense";
import { ResultSetDataHolder } from "@l-v-yonsama/multi-platform-database-drivers";
import * as path from "path";
import { VariablesPanel } from "../panels/VariablesPanel";
import { activateStatusBar } from "../statusBar";
import {
  CELL_OPEN_MDH,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CREATE_NEW_NOTEBOOK,
  NOTEBOOK_TYPE,
  SHOW_ALL_RDH,
  SHOW_ALL_VARIABLES,
} from "../constant";

export function activateNotebook(context: ExtensionContext, stateStorage: StateStorage) {
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
    commands.registerCommand(CELL_OPEN_MDH, async (cell: NotebookCell) => {
      const filePath = window.activeNotebookEditor?.notebook.uri.fsPath;
      const rdh: ResultSetDataHolder = cell.outputs?.[0].metadata?.rdh;
      const title = filePath ? path.basename(filePath) : rdh.meta.tableName ?? "CELL" + cell.index;
      console.log("called show rdh  cell", cell);
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
        .filter(
          (it) =>
            it.kind === NotebookCellKind.Code &&
            it.document.languageId === "sql" &&
            it.outputs.length > 0 &&
            it.outputs[0].metadata?.rdh
        )
        .map((it) => it.outputs[0].metadata?.rdh);
      const title = path.basename(filePath);
      MdhPanel.render(context.extensionUri, title, rdhList);
    })
  );
}
