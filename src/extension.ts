import { ExtensionContext, commands, window } from "vscode";
import { ResourceTreeProvider } from "./resourceTree/ResourceTreeProvider";
import { HistoryTreeProvider } from "./historyTree/HistoryTreeProvider";
import { activateFormProvider, SQLConfigurationViewProvider } from "./form";
import { StateStorage } from "./utilities/StateStorage";
import { DBDriverResolver } from "@l-v-yonsama/multi-platform-database-drivers";

import { ScanPanel } from "./panels/ScanPanel";
import { MdhPanel } from "./panels/MdhPanel";
import { activateNotebook } from "./notebook/activator";
import { activateLogger, log, setupDisposeLogger } from "./utilities/logger";
import { DiffPanel } from "./panels/DiffPanel";
import { DiffTabParam } from "./panels/DiffPanel";
import { registerResourceTreeCommand } from "./resourceTree/ResourceTreeCommand";
import { EXTENSION_NAME, SHOW_RDH_DIFF } from "./constant";
import { activateRuleEditor } from "./ruleEditor/activator";
import { initializePath } from "./utilities/fsUtil";
import { activateCodeResolverEditor } from "./codeResolverEditor/activator";
import { ViewConditionPanel } from "./panels/ViewConditionPanel";
import { NotebookCellMetadataPanel } from "./panels/NotebookCellMetadataPanel";
import { HelpProvider } from "./help/HelpProvider";
import { registerHistoryTreeCommand } from "./historyTree/HistoryTreeCommand";

const PREFIX = "[extension]";

let connectionSettingViewProvider: SQLConfigurationViewProvider;

export async function activate(context: ExtensionContext) {
  initializePath(context);
  const stateStorage = new StateStorage(context, context.secrets);
  const dbResourceTree = new ResourceTreeProvider(context, stateStorage);
  const historyTreeProvider = new HistoryTreeProvider(context, stateStorage);

  activateLogger(context, EXTENSION_NAME);
  log(`${PREFIX} start activation.`);
  ScanPanel.setStateStorage(stateStorage);
  MdhPanel.setStateStorage(stateStorage);
  DiffPanel.setStateStorage(stateStorage);
  ViewConditionPanel.setStateStorage(stateStorage);
  NotebookCellMetadataPanel.setStateStorage(stateStorage);

  window.registerTreeDataProvider("database-notebook-connections", dbResourceTree);
  window.registerTreeDataProvider("database-notebook-histories", historyTreeProvider);

  const helpTreeView = window.createTreeView("database-notebook-helpfeedback", {
    treeDataProvider: new HelpProvider(),
  });
  helpTreeView.onDidChangeSelection((e) => {
    e.selection.forEach((item) => {
      item.handleClick();
    });
  });

  connectionSettingViewProvider = activateFormProvider(context, stateStorage);

  registerResourceTreeCommand({
    context,
    stateStorage,
    dbResourceTree,
    connectionSettingViewProvider,
  });

  registerHistoryTreeCommand({
    context,
    stateStorage,
    historyTreeProvider,
  });

  // Notebook
  activateNotebook(context, stateStorage);

  // Record rule editor
  activateRuleEditor(context, stateStorage);
  // Code resolver editor
  activateCodeResolverEditor(context, stateStorage);

  // DIFF
  commands.registerCommand(SHOW_RDH_DIFF, (params: DiffTabParam) => {
    DiffPanel.render(context.extensionUri, params);
  });
  log(`${PREFIX} end activation.`);
  setupDisposeLogger(context);

  // process.on("uncaughtException", function (err) {
  //   console.log("⭐️⭐️ [uncaughtException]----------------------------------");
  //   console.log(err.name);
  //   console.log(err.message);
  //   console.log(err.toString());
  //   console.log(err.stack);
  //   log("⭐️⭐️uncaughtException:" + err);
  // });

  // process.on("unhandledRejection", function (reason, err) {
  //   console.log("⭐️⭐️ [unhandledRejection]----------------------------------");
  //   console.log(reason);
  //   console.log(err);
  //   log("⭐️⭐️unhandledRejection:" + err);
  // });
}

export async function deactivate() {
  log(`⭐️⭐️${PREFIX} deactivate`);
  try {
    await DBDriverResolver.getInstance().closeAll();
  } catch (e) {
    console.error(e);
  }
  return undefined;
}
