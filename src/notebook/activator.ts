import { DBNotebookSerializer } from "./serializer";
import { MainController } from "./controller";
import { MdhPanel } from "../panels/MdhPanel";
import { StateStorage } from "../utilities/StateStorage";
import {
  ExtensionContext,
  FileType,
  NotebookCell,
  NotebookCellData,
  NotebookCellKind,
  NotebookData,
  NotebookEdit,
  Uri,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import { CellMeta, NotebookMeta } from "../types/Notebook";
import { activateIntellisense } from "./intellisense";
import { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
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
  SPECIFY_CONNECTION_ALL,
  SPECIFY_RULES_TO_APPLY,
  USE_RULES,
} from "../constant";

export function activateNotebook(context: ExtensionContext, stateStorage: StateStorage) {
  let controller: MainController;
  activateStatusBar(context);
  activateIntellisense(context, stateStorage);

  const createSpecifyToUseRuleCommand = async () => {
    const notebook = window.activeNotebookEditor?.notebook;
    if (!notebook) {
      return;
    }
    const metadata: NotebookMeta = {
      ...notebook.metadata,
    };
    let wsfolder = workspace.workspaceFolders?.[0].uri;
    if (!wsfolder) {
      return;
    }
    const rootPath = wsfolder.fsPath;

    const toRuleFileInfo = async (dir: Uri) => {
      const allFiles = await workspace.fs.readDirectory(dir);
      const ruleFiles = allFiles
        .filter((it) => it[1] === FileType.File && it[0].endsWith(".rrule"))
        .map((it) => it[0]);
      const ruleDirs = allFiles
        .filter(
          (it) => it[1] === FileType.Directory && it[0].toLocaleLowerCase().indexOf("rule") >= 0
        )
        .map((it) => it[0]);
      return {
        relativePath: path.relative(rootPath, dir.fsPath),
        fsPath: dir.fsPath,
        ruleFiles,
        ruleDirs,
      };
    };

    const ruleFileInfoList = [];
    const currentDirInfo = await toRuleFileInfo(wsfolder);
    ruleFileInfoList.push(currentDirInfo);
    for (const ruleDir of currentDirInfo.ruleDirs) {
      ruleFileInfoList.push(
        await toRuleFileInfo(Uri.file(path.join(currentDirInfo.fsPath, ruleDir)))
      );
    }

    const hasRuleFile = ruleFileInfoList.some((it) => it.ruleFiles.length > 0);
    if (hasRuleFile) {
      const items = ruleFileInfoList.map((it) => ({
        label: it.relativePath,
        description: `${it.ruleFiles.length} file${it.ruleFiles.length === 1 ? "" : "s"}`,
      }));
      items.unshift({
        label: "No use",
        description: "No use of Record rules",
      });
      const result = await window.showQuickPick(items);
      if (result) {
        if (metadata.rulesFolder === result.label) {
          return;
        }
        if (result.label === "No use") {
          metadata.rulesFolder = undefined;
        } else {
          metadata.rulesFolder = result.label;
        }
        const edit = new WorkspaceEdit();
        const nbEdit = NotebookEdit.updateNotebookMetadata(metadata);
        edit.set(notebook.uri, [nbEdit]);
        await workspace.applyEdit(edit);
      }
    } else {
      await window.showInformationMessage(
        `First create a rules file in your workspace or in a folder directly under it`
      );
    }
  };

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
  context.subscriptions.push(
    commands.registerCommand(SPECIFY_CONNECTION_ALL, async () => {
      const cells = window.activeNotebookEditor?.notebook.getCells();
      if (!cells) {
        return;
      }
      if (cells.every((it) => it.document.languageId !== "sql")) {
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
          if (cell.document.languageId !== "sql") {
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
    commands.registerCommand(SPECIFY_RULES_TO_APPLY, createSpecifyToUseRuleCommand)
  );
  context.subscriptions.push(commands.registerCommand(USE_RULES, createSpecifyToUseRuleCommand));
}
