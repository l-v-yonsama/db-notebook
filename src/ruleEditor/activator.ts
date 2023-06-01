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
import * as path from "path";
import { activateStatusBar } from "../statusBar";
import {
  CELL_OPEN_MDH,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CREATE_NEW_NOTEBOOK,
  CREATE_NEW_RECORD_RULE,
  NOTEBOOK_TYPE,
  SHOW_ALL_RDH,
  SHOW_ALL_VARIABLES,
} from "../constant";
import { RecordRuleEditorProvider } from "./editorProvider";

export function activateRuleEditor(context: ExtensionContext, stateStorage: StateStorage) {
  context.subscriptions.push(RecordRuleEditorProvider.register(context));

  // Commands
  context.subscriptions.push(
    commands.registerCommand(CREATE_NEW_RECORD_RULE, async (tableName?: any) => {
      const doc = await workspace.openTextDocument({
        language: "rrule",
        content: "",
      });
      window.showTextDocument(doc);
    })
  );
}
