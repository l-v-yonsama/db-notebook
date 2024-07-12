import { ExtensionContext, Uri, commands, window, workspace } from "vscode";
import { ResourceTreeProvider } from "./resourceTree/ResourceTreeProvider";
import { HistoryTreeProvider } from "./historyTree/HistoryTreeProvider";
import { activateFormProvider, SQLConfigurationViewProvider } from "./form";
import { StateStorage } from "./utilities/StateStorage";
import { DBDriverResolver, DbSchema } from "@l-v-yonsama/multi-platform-database-drivers";

import { ScanPanel } from "./panels/ScanPanel";
import { activateNotebook } from "./notebook/activator";
import { activateLogger, log, setupDisposeLogger } from "./utilities/logger";
import { registerResourceTreeCommand } from "./resourceTree/ResourceTreeCommand";
import {
  BOTTOM_DIFF_MDH_VIEWID,
  BOTTOM_MDH_VIEWID,
  EXTENSION_NAME,
  OPEN_MDH_VIEWER,
  SHOW_CSV,
  SHOW_HAR,
  OPEN_DIFF_MDH_VIEWER,
  BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID,
  OPEN_COUNT_FOR_ALL_TABLES_VIEWER,
  BOTTOM_CHARTS_VIEWID,
  OPEN_CHARTS_VIEWER,
} from "./constant";
import { activateRuleEditor } from "./ruleEditor/activator";
import { initializeStoragePath } from "./utilities/fsUtil";
import { activateCodeResolverEditor } from "./codeResolverEditor/activator";
import { ViewConditionPanel } from "./panels/ViewConditionPanel";
import { NotebookCellMetadataPanel } from "./panels/NotebookCellMetadataPanel";
import { HelpProvider } from "./help/HelpProvider";
import { registerHistoryTreeCommand } from "./historyTree/HistoryTreeCommand";
import { MdhViewProvider } from "./views/MdhViewProvider";
import { HarFilePanel } from "./panels/HarFilePanel";
import { CsvParseSettingPanel } from "./panels/CsvParseSettingPanel";
import { ChartsViewParams, DiffMdhViewTabParam, MdhViewParams } from "./types/views";
import { DiffMdhViewProvider } from "./views/DiffMdhViewProvider";
import { CountRecordViewProvider } from "./views/CountRecordViewProvider";
import { ChartsViewProvider } from "./views/ChartsViewProvider";

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
