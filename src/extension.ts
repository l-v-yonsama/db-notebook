import { ExtensionContext, commands, window, workspace } from "vscode";
import { ResourceTreeProvider } from "./resourceTree/ResourceTreeProvider";
import { activateFormProvider, SQLConfigurationViewProvider } from "./form";
import { StateStorage } from "./utilities/StateStorage";
import { DBDriverResolver } from "@l-v-yonsama/multi-platform-database-drivers";

import { ScanPanel } from "./panels/ScanPanel";
import { MdhPanel } from "./panels/MdhPanel";
import { activateNotebook } from "./notebook/activator";
import { activateLogger, log } from "./utilities/logger";
import { DiffPanel } from "./panels/DiffPanel";
import { DiffTabParam } from "./panels/DiffPanel";
import { registerResourceTreeCommand } from "./resourceTree/ResourceTreeCommand";
import { EXTENSION_NAME, SHOW_RDH_DIFF } from "./constant";
import { activateRuleEditor } from "./ruleEditor/activator";
import { setStoragePath } from "./utilities/fsUtil";

const PREFIX = "[extension]";

let connectionSettingViewProvider: SQLConfigurationViewProvider;

export async function activate(context: ExtensionContext) {
  setStoragePath(context.globalStorageUri);
  const stateStorage = new StateStorage(context, context.secrets);
  const dbResourceTree = new ResourceTreeProvider(context, stateStorage);

  activateLogger(context, EXTENSION_NAME);
  log(`${PREFIX} start activation.`);
  ScanPanel.setStateStorage(stateStorage);
  MdhPanel.setStateStorage(stateStorage);
  DiffPanel.setStateStorage(stateStorage);

  window.registerTreeDataProvider("database-notebook-connections", dbResourceTree);

  connectionSettingViewProvider = activateFormProvider(context, stateStorage);

  registerResourceTreeCommand({
    context,
    stateStorage,
    dbResourceTree,
    connectionSettingViewProvider,
  });

  // Notebook
  activateNotebook(context, stateStorage);

  // Record rule editor
  activateRuleEditor(context, stateStorage);

  // DIFF
  commands.registerCommand(SHOW_RDH_DIFF, (params: DiffTabParam) => {
    DiffPanel.render(context.extensionUri, params);
  });
  log(`${PREFIX} end activation.`);
}

export async function deactivate() {
  log(`${PREFIX} deactivate`);
  try {
    await DBDriverResolver.getInstance().closeAll();
  } catch (e) {
    console.error(e);
  }
  return undefined;
}
