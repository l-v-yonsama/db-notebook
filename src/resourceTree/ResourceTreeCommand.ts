import {
  BaseSQLSupportDriver,
  DBDriverResolver,
  DbConnection,
  DbDatabase,
  DbDynamoTable,
  DbResource,
  DbSchema,
  DbTable,
  RdsDatabase,
  RedisDriver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  ExtensionContext,
  NotebookCellData,
  NotebookCellKind,
  commands,
  env,
  window,
} from "vscode";
import {
  CLEAR_DEFAULT_CON_FOR_SQL_CELL,
  COUNT_FOR_ALL_TABLES,
  CREATE_CONNECTION_SETTING,
  CREATE_ER_DIAGRAM,
  CREATE_ER_DIAGRAM_WITH_SETTINGS,
  CREATE_INSERT_SCRIPT_WITH_SETTINGS,
  CREATE_NEW_NOTEBOOK,
  DELETE_CONNECTION_SETTING,
  DUPLICATE_CONNECTION_SETTING,
  EDIT_CONNECTION_SETTING,
  FLUSH_DB,
  GET_LOCKS,
  GET_SESSIONS,
  OPEN_COUNT_FOR_ALL_TABLES_VIEWER,
  OPEN_TOOLS_VIEWER,
  REFRESH_RESOURCES,
  RETRIEVE_RESOURCES,
  RETRIEVE_TABLE_RECORDS,
  SHOW_CONNECTION_SETTING,
  SHOW_RESOURCE_PROPERTIES,
  SHOW_SCAN_PANEL,
  SPECIFY_DEFAULT_CON_FOR_SQL_CELL,
  WRITE_ER_DIAGRAM_TO_CLIPBOARD,
} from "../constant";
import { SQLConfigurationViewProvider } from "../form";
import { CreateInsertScriptSettingsPanel } from "../panels/CreateInsertScriptSettingsPanel";
import { ERDiagramSettingsPanel } from "../panels/ERDiagramSettingsPanel";
import { ScanPanel } from "../panels/ScanPanel";
import { ViewConditionPanel } from "../panels/ViewConditionPanel";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { createErDiagram, createSimpleERDiagramParams } from "../utilities/erDiagramGenerator";
import { StateStorage } from "../utilities/StateStorage";
import { ToolsViewParams } from "../views/ToolsViewProvider";
import { ResourceTreeProvider } from "./ResourceTreeProvider";

type ResourceTreeParams = {
  context: ExtensionContext;
  stateStorage: StateStorage;
  dbResourceTree: ResourceTreeProvider;
  connectionSettingViewProvider: SQLConfigurationViewProvider;
};

export const registerResourceTreeCommand = (params: ResourceTreeParams) => {
  registerConnectionSettingCommand(params);
  registerDbResourceCommand(params);
};

const registerConnectionSettingCommand = (params: ResourceTreeParams) => {
  const { context, stateStorage, dbResourceTree, connectionSettingViewProvider } = params;

  commands.registerCommand(CREATE_CONNECTION_SETTING, () => {
    connectionSettingViewProvider.setForm("create");
  });
  commands.registerCommand(SHOW_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("show", conRes);
  });
  commands.registerCommand(EDIT_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("update", conRes);
  });
  commands.registerCommand(DUPLICATE_CONNECTION_SETTING, async (conRes: DbConnection) => {
    connectionSettingViewProvider.setForm("duplicate", conRes);
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
};

const registerDbResourceCommand = (params: ResourceTreeParams) => {
  const { context, stateStorage, dbResourceTree, connectionSettingViewProvider } = params;

  commands.registerCommand(REFRESH_RESOURCES, () => {
    dbResourceTree.refresh(true);
  });

  commands.registerCommand(RETRIEVE_RESOURCES, async (conRes: DbConnection) => {
    try {
      conRes.isInProgress = true;
      dbResourceTree.changeConnectionTreeData(conRes);

      const { ok, message, result } = await stateStorage.loadResource(conRes.name, true, true);
      conRes.isInProgress = false;
      conRes.clearChildren();
      if (ok && result?.db) {
        result.db.forEach((dbRes) => conRes.addChild(dbRes));
      } else {
        showWindowErrorMessage(message);
      }
    } catch (e) {
      showWindowErrorMessage(e);
    }
    dbResourceTree.changeConnectionTreeData(conRes);
  });

  commands.registerCommand(SPECIFY_DEFAULT_CON_FOR_SQL_CELL, async (conRes: DbConnection) => {
    stateStorage.setDefaultConnectionName(conRes.name);
    dbResourceTree.changeConnectionTreeData(conRes);
  });

  commands.registerCommand(CLEAR_DEFAULT_CON_FOR_SQL_CELL, async (conRes: DbConnection) => {
    stateStorage.setDefaultConnectionName("");
    dbResourceTree.changeConnectionTreeData(conRes);
  });

  context.subscriptions.push(
    commands.registerCommand(GET_LOCKS, async (dbRes: DbDatabase) => {
      const { conName } = dbRes.meta;
      const commandParam: ToolsViewParams = { viewMode: "locks", conName, res: dbRes };
      commands.executeCommand(OPEN_TOOLS_VIEWER, commandParam);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(GET_SESSIONS, async (dbRes: DbDatabase) => {
      const { conName } = dbRes.meta;
      const commandParam: ToolsViewParams = { viewMode: "sessions", conName, res: dbRes };
      commands.executeCommand(OPEN_TOOLS_VIEWER, commandParam);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(COUNT_FOR_ALL_TABLES, async (schemaRes: DbSchema) => {
      commands.executeCommand(OPEN_COUNT_FOR_ALL_TABLES_VIEWER, schemaRes);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(RETRIEVE_TABLE_RECORDS, async (tableRes: DbTable | DbDynamoTable) => {
      const { conName, schemaName } = tableRes.meta;
      const setting = await stateStorage.getConnectionSettingByName(conName);
      if (!setting) {
        return;
      }
      const { ok, message, result } =
        await DBDriverResolver.getInstance().workflow<BaseSQLSupportDriver>(
          setting,
          async (driver) => {
            return await driver.count({
              table: tableRes.name,
              schema: driver.isSchemaSpecificationSvailable() ? schemaName : undefined,
            });
          }
        );

      if (ok && result !== undefined) {
        ViewConditionPanel.render(context.extensionUri, tableRes, result);
      } else {
        showWindowErrorMessage(message);
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

  // ER diagram
  commands.registerCommand(CREATE_ER_DIAGRAM, async (tableRes: DbTable) => {
    try {
      const { conName, schemaName } = tableRes.meta;
      const dbs = stateStorage.getResourceByName(conName);
      let schema: DbSchema | undefined = undefined;
      if (dbs && dbs[0] instanceof RdsDatabase) {
        schema = (dbs[0] as RdsDatabase).getSchema({ name: schemaName });
      }
      const params = createSimpleERDiagramParams(schema, tableRes);
      const content = createErDiagram(params);
      const cell = new NotebookCellData(NotebookCellKind.Markup, content, "markdown");
      commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
    } catch (e) {
      showWindowErrorMessage(e);
    }
  });
  commands.registerCommand(CREATE_ER_DIAGRAM_WITH_SETTINGS, async (tableRes: DbTable) => {
    try {
      const { conName, schemaName } = tableRes.meta;
      const rdb = stateStorage.getFirstRdsDatabaseByName(conName);
      const schema = rdb?.getSchema({ name: schemaName });
      let title = tableRes.comment ?? "";
      if (!title) {
        title = tableRes.name;
      }
      ERDiagramSettingsPanel.render(context.extensionUri, {
        title,
        tables: schema?.children ?? [],
        selectedTable: tableRes,
      });
    } catch (e) {
      showWindowErrorMessage(e);
    }
  });
  commands.registerCommand(WRITE_ER_DIAGRAM_TO_CLIPBOARD, async (tableRes: DbTable) => {
    try {
      const { conName, schemaName } = tableRes.meta;
      const rdb = stateStorage.getFirstRdsDatabaseByName(conName);
      const schema = rdb?.getSchema({ name: schemaName });
      const params = createSimpleERDiagramParams(schema, tableRes);
      const content = createErDiagram(params);
      env.clipboard.writeText(content);
    } catch (e) {
      showWindowErrorMessage(e);
    }
  });

  // scripts
  commands.registerCommand(CREATE_INSERT_SCRIPT_WITH_SETTINGS, async (tableRes: DbTable) => {
    try {
      const { conName, schemaName } = tableRes.meta;
      const rdb = stateStorage.getFirstRdsDatabaseByName(conName);
      const schema = rdb?.getSchema({ name: schemaName });
      if (!schema) {
        return;
      }
      let title = tableRes.comment ?? "";
      if (!title) {
        title = tableRes.name;
      }
      CreateInsertScriptSettingsPanel.render(context.extensionUri, schema.name, tableRes);
    } catch (e) {
      showWindowErrorMessage(e);
    }
  });
};
