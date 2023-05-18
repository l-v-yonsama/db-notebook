import { ExtensionContext, commands, window, workspace } from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import {
  DBDriverResolver,
  DbConnection,
  DbResource,
  DbTable,
  RDSBaseDriver,
  RedisDriver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResourceTreeProvider } from "./ResourceTreeProvider";
import { MdhPanel } from "../panels/MdhPanel";
import { ScanPanel } from "../panels/ScanPanel";
import {
  CLONE_CONNECTION_SETTING,
  CREATE_CONNECTION_SETTING,
  DELETE_CONNECTION_SETTING,
  EDIT_CONNECTION_SETTING,
  FLUSH_DB,
  REFRESH_RESOURCES,
  RETRIEVE_RESOURCES,
  RETRIEVE_TABLE_RECORDS,
  SHOW_CONNECTION_SETTING,
  SHOW_RESOURCE_PROPERTIES,
  SHOW_SCAN_PANEL,
} from "../constant";
import { SQLConfigurationViewProvider } from "../form";

export const registerResourceTreeCommand = (
  context: ExtensionContext,
  stateStorage: StateStorage,
  dbResourceTree: ResourceTreeProvider,
  connectionSettingViewProvider: SQLConfigurationViewProvider
) => {
  // -----------------------------------------
  // for connection-settings
  // -----------------------------------------
  commands.registerCommand(CREATE_CONNECTION_SETTING, () => {
    connectionSettingViewProvider.setForm("create");
  });
  commands.registerCommand(SHOW_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("show", conRes);
  });
  commands.registerCommand(EDIT_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("update", conRes);
  });
  commands.registerCommand(CLONE_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("clone", conRes);
  });
  commands.registerCommand(DELETE_CONNECTION_SETTING, async (conRes: DbConnection) => {
    const answer = await window.showInformationMessage(
      `Are you sure to delete '${conRes.name}' setting?`,
      "YES",
      "NO"
    );
    if (answer === "YES") {
      await stateStorage.deleteConnectionSetting(conRes.name);
      dbResourceTree.refresh(true);
    }
  });
  commands.registerCommand(SHOW_RESOURCE_PROPERTIES, async (res: DbResource) => {
    connectionSettingViewProvider.setForm("show", res);
  });
  // -----------------------------------------
  // for db-resouce
  // -----------------------------------------
  commands.registerCommand(REFRESH_RESOURCES, () => {
    dbResourceTree.refresh(true);
  });

  commands.registerCommand(RETRIEVE_RESOURCES, async (conRes: DbConnection) => {
    try {
      conRes.isInProgress = true;
      dbResourceTree.changeConnectionTreeData(conRes);

      try {
        const dbResList = await stateStorage.loadResource(conRes.name, true, true);
        conRes.isInProgress = false;
        conRes.clearChildren();
        dbResList?.forEach((dbRes) => conRes.addChild(dbRes));
      } catch (e: any) {
        window.showErrorMessage(e.message);
      }
    } catch (e: any) {
      window.showErrorMessage(e.message);
    }
    dbResourceTree.changeConnectionTreeData(conRes);
  });

  context.subscriptions.push(
    commands.registerCommand(RETRIEVE_TABLE_RECORDS, async (tableRes: DbTable) => {
      const { conName, schemaName } = tableRes.meta;
      const setting = await stateStorage.getConnectionSettingByName(conName);
      if (!setting) {
        return;
      }
      const { ok, message, result } = await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
        setting,
        async (driver) => {
          return await driver.viewData(tableRes.name, { schemaName });
        }
      );

      if (ok && result) {
        MdhPanel.render(context.extensionUri, tableRes.name, [result]);
      } else {
        window.showErrorMessage(message);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand(FLUSH_DB, async (conRes: DbConnection) => {
      await DBDriverResolver.getInstance().workflow<RedisDriver>(conRes, async (driver) => {
        const answer = await window.showInformationMessage(
          `Are you sure to delete all the keys of the currently selected DB?`,
          "YES",
          "NO"
        );
        if (answer !== "YES") {
          return;
        }
        await driver.flushDb();
        commands.executeCommand(RETRIEVE_RESOURCES, conRes);
      });
    })
  );

  // Show scan panel
  context.subscriptions.push(
    commands.registerCommand(SHOW_SCAN_PANEL, async (target: DbResource) => {
      ScanPanel.render(context.extensionUri, target);
    })
  );
};
