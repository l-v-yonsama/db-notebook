import { DBDriverResolver, DbSchema } from "@l-v-yonsama/multi-platform-database-drivers";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { activateFormProvider, SQLConfigurationViewProvider } from "./form";
import { HistoryTreeProvider } from "./historyTree/HistoryTreeProvider";
import { ResourceTreeProvider } from "./resourceTree/ResourceTreeProvider";
import { StateStorage } from "./utilities/StateStorage";

import { activateCodeResolverEditor } from "./codeResolverEditor/activator";
import {
  BOTTOM_CHARTS_VIEWID,
  BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID,
  BOTTOM_DIFF_MDH_VIEWID,
  BOTTOM_MDH_VIEWID,
  BOTTOM_TOOLS_VIEWID,
  EXTENSION_NAME,
  OPEN_CHARTS_VIEWER,
  OPEN_COUNT_FOR_ALL_TABLES_VIEWER,
  OPEN_DIFF_MDH_VIEWER,
  OPEN_MDH_VIEWER,
  OPEN_TOOLS_VIEWER,
  SHOW_CSV,
  SHOW_HAR,
} from "./constant";
import { HelpProvider } from "./help/HelpProvider";
import { registerHistoryTreeCommand } from "./historyTree/HistoryTreeCommand";
import { activateNotebook } from "./notebook/activator";
import { CsvParseSettingPanel } from "./panels/CsvParseSettingPanel";
import { HarFilePanel } from "./panels/HarFilePanel";
import { NotebookCellMetadataPanel } from "./panels/NotebookCellMetadataPanel";
import { ScanPanel } from "./panels/ScanPanel";
import { ViewConditionPanel } from "./panels/ViewConditionPanel";
import { registerResourceTreeCommand } from "./resourceTree/ResourceTreeCommand";
import { activateRuleEditor } from "./ruleEditor/activator";
import { ChartsViewParams, DiffMdhViewTabParam, MdhViewParams } from "./types/views";
import { initializeStoragePath } from "./utilities/fsUtil";
import { activateLogger, log, setupDisposeLogger } from "./utilities/logger";
import { ChartsViewProvider } from "./views/ChartsViewProvider";
import { CountRecordViewProvider } from "./views/CountRecordViewProvider";
import { DiffMdhViewProvider } from "./views/DiffMdhViewProvider";
import { MdhViewProvider } from "./views/MdhViewProvider";
import { ToolsViewParams, ToolsViewProvider } from "./views/ToolsViewProvider";

const PREFIX = "[extension]";

let connectionSettingViewProvider: SQLConfigurationViewProvider;

export async function activate(context: ExtensionContext) {
  const registerDisposableCommand = (
    command: string,
    callback: (...args: any[]) => any,
    thisArg?: any
  ) => {
    const disposable = commands.registerCommand(command, callback, thisArg);
    context.subscriptions.push(disposable);
  };

  initializeStoragePath(context);
  const stateStorage = new StateStorage(context, context.secrets);
  const dbResourceTree = new ResourceTreeProvider(context, stateStorage);
  const historyTreeProvider = new HistoryTreeProvider(context, stateStorage);

  activateLogger(context, EXTENSION_NAME);
  log(`${PREFIX} start activation.`);

  ScanPanel.setStateStorage(stateStorage);
  ViewConditionPanel.setStateStorage(stateStorage);
  NotebookCellMetadataPanel.setStateStorage(stateStorage);
  HarFilePanel.setStateStorage(stateStorage);

  window.registerTreeDataProvider("database-notebook-connections", dbResourceTree);
  window.registerTreeDataProvider("database-notebook-histories", historyTreeProvider);

  // VIEWS
  const helpTreeView = window.createTreeView("database-notebook-helpfeedback", {
    treeDataProvider: new HelpProvider(),
  });
  helpTreeView.onDidChangeSelection((e) => {
    e.selection.forEach((item) => {
      item.handleClick();
    });
  });

  // Connection view
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

  //  Viewer
  {
    registerDisposableCommand(SHOW_CSV, async (csvUri: Uri) => {
      CsvParseSettingPanel.render(context.extensionUri, csvUri);
    });

    registerDisposableCommand(SHOW_HAR, async (harUri: Uri) => {
      HarFilePanel.render(context.extensionUri, harUri);
    });

    // Mdh View
    const mdhViewProvider = new MdhViewProvider(BOTTOM_MDH_VIEWID, context, stateStorage);
    context.subscriptions.push(
      window.registerWebviewViewProvider(mdhViewProvider.viewId, mdhViewProvider)
    );

    registerDisposableCommand(OPEN_MDH_VIEWER, async (params: MdhViewParams) => {
      mdhViewProvider.render(params);
    });

    // Diff Mdh View
    const diffMdhViewProvider = new DiffMdhViewProvider(
      BOTTOM_DIFF_MDH_VIEWID,
      context,
      stateStorage
    );
    context.subscriptions.push(
      window.registerWebviewViewProvider(diffMdhViewProvider.viewId, diffMdhViewProvider)
    );
    commands.registerCommand(OPEN_DIFF_MDH_VIEWER, (params: DiffMdhViewTabParam) => {
      diffMdhViewProvider.render(params);
    });

    // Charts View
    const chartsViewProvider = new ChartsViewProvider(BOTTOM_CHARTS_VIEWID, context, stateStorage);
    context.subscriptions.push(
      window.registerWebviewViewProvider(chartsViewProvider.viewId, chartsViewProvider)
    );
    commands.registerCommand(OPEN_CHARTS_VIEWER, (params: ChartsViewParams) => {
      chartsViewProvider.render(params);
    });

    // Count records View
    const countRecordViewProvider = new CountRecordViewProvider(
      BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID,
      context,
      stateStorage
    );
    context.subscriptions.push(
      window.registerWebviewViewProvider(countRecordViewProvider.viewId, countRecordViewProvider)
    );

    registerDisposableCommand(OPEN_COUNT_FOR_ALL_TABLES_VIEWER, async (schemaRes: DbSchema) => {
      countRecordViewProvider.render(schemaRes);
    });

    // Tools View
    const toolsViewProvider = new ToolsViewProvider(BOTTOM_TOOLS_VIEWID, context, stateStorage);
    context.subscriptions.push(
      window.registerWebviewViewProvider(toolsViewProvider.viewId, toolsViewProvider)
    );

    registerDisposableCommand(OPEN_TOOLS_VIEWER, async (params: ToolsViewParams) => {
      toolsViewProvider.render(params);
    });
  }

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
    console.error(PREFIX, e);
  }
  return undefined;
}
