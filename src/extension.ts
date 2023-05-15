import * as vscode from "vscode";
import { commands, ExtensionContext } from "vscode";
import { DBResourceTreeProvider } from "./DBResourceTreeProvider";
import { activateFormProvider, SQLConfigurationViewProvider } from "./form";
import { StateStorage } from "./utilities/StateStorage";
import {
  DbConnection,
  DBDriverResolver,
  DbResource,
  DbTable,
  RDSBaseDriver,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";

import { ScanPanel } from "./panels/ScanPanel";
import { MdhPanel } from "./panels/MdhPanel";
import { activateNotebook } from "./notebook/activator";
import { activateLogger } from "./utilities/logger";
import { DiffPanel } from "./panels/DiffPanel";
import { DiffTabParam } from "./panels/DiffPanel";

export const EXTENSION_NAME = "database-notebook";

export const CONNECT = `${EXTENSION_NAME}.connect`;
export const DISCONNECT = `${EXTENSION_NAME}.disconnect`;
export const DISCONNECT_ALL = `${EXTENSION_NAME}.disconnect-all`;

export const REFRESH_RESOURCES = `${EXTENSION_NAME}.refresh-resources`;
export const RETRIEVE_RESOURCES = `${EXTENSION_NAME}.retrieve-resources`;
export const RETRIEVE_TABLE_RECORDS = `${EXTENSION_NAME}.retrieve-table-records`;

export const CREATE_CONNECTION_SETTING = `${EXTENSION_NAME}.create-connection-setting`;
export const SHOW_CONNECTION_SETTING = `${EXTENSION_NAME}.show-connection-setting`;
export const EDIT_CONNECTION_SETTING = `${EXTENSION_NAME}.edit-connection-setting`;
export const CLONE_CONNECTION_SETTING = `${EXTENSION_NAME}.clone-connection-setting`;
export const DELETE_CONNECTION_SETTING = `${EXTENSION_NAME}.delete-connection-setting`;

export const SHOW_SCAN_PANEL = `${EXTENSION_NAME}.show-scan-panel`;
export const SHOW_METADATA_RDH = `${EXTENSION_NAME}.show-metadata-rdh`;
export const SHOW_RESOURCE_PROPERTIES = `${EXTENSION_NAME}.show-resource-properties`;

export const SHOW_RDH_DIFF = `${EXTENSION_NAME}.show-rdh-diff`;

let connectionSettingViewProvider: SQLConfigurationViewProvider;

export async function activate(context: ExtensionContext) {
  const stateStorage = new StateStorage(context, context.secrets);
  const dbResourceTree = new DBResourceTreeProvider(context, stateStorage);

  activateLogger(context, EXTENSION_NAME);
  ScanPanel.setStateStorage(stateStorage);
  MdhPanel.setStateStorage(stateStorage);
  DiffPanel.setStateStorage(stateStorage);

  vscode.window.registerTreeDataProvider("database-notebook-connections", dbResourceTree);

  connectionSettingViewProvider = activateFormProvider(context, stateStorage);

  vscode.commands.registerCommand(REFRESH_RESOURCES, () => {
    dbResourceTree.refresh(true);
  });

  registerConnectionSettingCommand(stateStorage, dbResourceTree);

  registerDBResourceCommand(context, stateStorage, dbResourceTree);

  // Notebook
  activateNotebook(context, stateStorage);

  // DIFF
  vscode.commands.registerCommand(SHOW_RDH_DIFF, (params: DiffTabParam) => {
    DiffPanel.render(context.extensionUri, params);
  });
}

const registerConnectionSettingCommand = (
  stateStorage: StateStorage,
  dbResourceTree: DBResourceTreeProvider
) => {
  vscode.commands.registerCommand(CREATE_CONNECTION_SETTING, () => {
    connectionSettingViewProvider.setForm("create");
  });
  vscode.commands.registerCommand(SHOW_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("show", conRes);
  });
  vscode.commands.registerCommand(EDIT_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("update", conRes);
  });
  vscode.commands.registerCommand(CLONE_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("clone", conRes);
  });
  vscode.commands.registerCommand(DELETE_CONNECTION_SETTING, async (conRes: DbConnection) => {
    const answer = await vscode.window.showInformationMessage(
      `Are you sure to delete '${conRes.name}' setting?`,
      "YES",
      "NO"
    );
    if (answer === "YES") {
      await stateStorage.deleteConnectionSetting(conRes.name);
      dbResourceTree.refresh(true);
    }
  });
  vscode.commands.registerCommand(SHOW_RESOURCE_PROPERTIES, async (res: DbResource) => {
    connectionSettingViewProvider.setForm("show", res);
  });
};

// getInfomationSchemas
const registerDBResourceCommand = (
  context: ExtensionContext,
  stateStorage: StateStorage,
  dbResourceTree: DBResourceTreeProvider
) => {
  vscode.commands.registerCommand(RETRIEVE_RESOURCES, async (conRes: DbConnection) => {
    try {
      const driver = DBDriverResolver.getInstance().createDriver(conRes);
      conRes.isInProgress = true;
      dbResourceTree.changeConnectionTreeData(conRes);

      try {
        const dbResList = await stateStorage.loadResource(conRes.name, true, true);
        conRes.isInProgress = false;
        conRes.clearChildren();
        dbResList?.forEach((dbRes) => conRes.addChild(dbRes));
      } catch (e: any) {
        vscode.window.showErrorMessage(e.message);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(e.message);
    }
    dbResourceTree.changeConnectionTreeData(conRes);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(RETRIEVE_TABLE_RECORDS, async (tableRes: DbTable) => {
      const { conName, schemaName } = tableRes.meta;
      const setting = await stateStorage.getConnectionSettingByName(conName);
      if (!setting) {
        return;
      }
      const driver = DBDriverResolver.getInstance().createDriver<RDSBaseDriver>(setting);
      const { ok, message, result } = await driver.flow(async () => {
        return await driver.viewData(tableRes.name, { schemaName });
      });
      if (ok && result) {
        MdhPanel.render(context.extensionUri, tableRes.name, [result]);
      } else {
        vscode.window.showErrorMessage(message);
      }
    })
  );

  // Show scan panel
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_SCAN_PANEL, async (target: DbResource) => {
      ScanPanel.render(context.extensionUri, target);
    })
  );
};

export async function deactivate() {
  try {
    await DBDriverResolver.getInstance().closeAll();
  } catch (e) {
    console.error(e);
  }
  return undefined;
}
