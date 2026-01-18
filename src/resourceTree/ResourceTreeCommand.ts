import {
  BaseSQLSupportDriver,
  DBDriverResolver,
  DbConnection,
  DbDatabase,
  DbDynamoTable,
  DbResource,
  DbSchema,
  DbSubscription,
  DbTable,
  MqttDatabase,
  RdsDatabase,
  RedisDriver,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  ExtensionContext,
  NotebookCellData,
  NotebookCellKind,
  TreeItem,
  TreeView,
  commands,
  env,
  window,
} from "vscode";
import {
  ADD_SUBSCRIPTION,
  CLEAR_DEFAULT_CON_FOR_SQL_CELL,
  CONNECT,
  COPY_RESOURCE_NAME,
  COUNT_FOR_ALL_TABLES,
  CREATE_CONNECTION_SETTING,
  CREATE_ER_DIAGRAM,
  CREATE_ER_DIAGRAM_WITH_SETTINGS,
  CREATE_INSERT_SCRIPT_WITH_SETTINGS,
  CREATE_NEW_NOTEBOOK,
  DELETE_CONNECTION_SETTING,
  DISCONNECT,
  DUPLICATE_CONNECTION_SETTING,
  EDIT_CONNECTION_SETTING,
  EDIT_SUBSCRIPTION,
  FLUSH_DB,
  GET_LOCKS,
  GET_SESSIONS,
  LOAD_DB_SCHEMA,
  OPEN_CHAT_2_QUERY,
  OPEN_COUNT_FOR_ALL_TABLES_VIEWER,
  OPEN_DB_NOTEBOOK,
  OPEN_TOOLS_VIEWER,
  REFRESH_RESOURCES,
  REMOVE_SUBSCRIPTION,
  RETRIEVE_TABLE_RECORDS,
  SHOW_CONNECTION_SETTING,
  SHOW_DYNAMO_QUERY_PANEL,
  SHOW_PUBLISH_EDITOR_PANEL,
  SHOW_RESOURCE_PROPERTIES,
  SHOW_SCAN_PANEL,
  SPECIFY_DEFAULT_CON_FOR_SQL_CELL,
  SUBSCRIBE,
  UNSUBSCRIBE,
  WRITE_ER_DIAGRAM_TO_CLIPBOARD,
} from "../constant";
import { SQLConfigurationViewProvider } from "../form";
import { MqttDriverManager } from "../mqtt/MqttDriverManager";
import { Chat2QueryPanel } from "../panels/Chat2QueryPanel";
import { CreateInsertScriptSettingsPanel } from "../panels/CreateInsertScriptSettingsPanel";
import { DynamoQueryPanel } from "../panels/DynamoQueryPanel";
import { ERDiagramSettingsPanel } from "../panels/ERDiagramSettingsPanel";
import { PublishEditorPanel } from "../panels/PublishEditorPanel";
import { ScanPanel } from "../panels/ScanPanel";
import { SubscriptionSettingPanel } from "../panels/SubscriptionSettingPanel";
import { ViewConditionPanel } from "../panels/ViewConditionPanel";
import { CellMeta } from "../types/Notebook";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { createErDiagram, createSimpleERDiagramParams } from "../utilities/erDiagramGenerator";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { ToolsViewParams } from "../views/ToolsViewProvider";
import { ResourceTreeProvider } from "./ResourceTreeProvider";

type ResourceTreeParams = {
  context: ExtensionContext;
  stateStorage: StateStorage;
  dbResourceTree: ResourceTreeProvider;
  dbResourceTreeView: TreeView<TreeItem>;
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
    if (res.resourceType === ResourceType.Subscription) {
      const subscriptionRes = res as DbSubscription;
      const { conName } = subscriptionRes.meta;
      const setting = await stateStorage.getConnectionSettingByName(conName);
      if (!setting) {
        return;
      }
      MqttDriverManager.getInstance(setting).showSubscriptionView(subscriptionRes);
    }
  });
};

const registerDbResourceCommand = (params: ResourceTreeParams) => {
  const { context, stateStorage, dbResourceTree, dbResourceTreeView } = params;

  commands.registerCommand(COPY_RESOURCE_NAME, async (res: DbResource | DbConnection) => {
    try {
      let target = res;
      if (!target) {
        const selection = dbResourceTreeView.selection;
        if (!selection || selection.length === 0) {
          return;
        }
        target = selection[0] as DbResource | DbConnection;
      }
      if (!target) {
        return;
      }

      const text = target.name;
      await env.clipboard.writeText(text);

      window.setStatusBarMessage(`Copied: ${text}`, 2000);
    } catch (e) {
      showWindowErrorMessage(e);
    }
  });

  commands.registerCommand(REFRESH_RESOURCES, () => {
    dbResourceTree.refresh(true);
  });

  commands.registerCommand(OPEN_DB_NOTEBOOK, async (conRes: DbConnection) => {
    const cell = new NotebookCellData(NotebookCellKind.Code, '', 'sql');
    const metadata: CellMeta = {
      connectionName: conRes.name
    };
    cell.metadata = metadata;
    commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
  });

  commands.registerCommand(LOAD_DB_SCHEMA, async (conRes: DbConnection) => {
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

  commands.registerCommand(CONNECT, async (conRes: DbConnection) => {
    try {
      conRes.isInProgress = true;
      dbResourceTree.changeConnectionTreeData(conRes);
      const setting = await stateStorage.getConnectionSettingByName(conRes.name);
      if (!setting) {
        return;
      }
      const manager = MqttDriverManager.getInstance(setting);
      log(`Connect to ${conRes.host}`);
      const message = await manager.connect();
      conRes.isInProgress = false;
      if (message) {
        showWindowErrorMessage(message);
        return;
      }
      log(`Connect ok`);
      const dbRes = await manager.getInfomationSchemas();
      if (dbRes) {
        for (const db of dbRes) {
          db.meta = {
            conName: conRes.name,
          };
          db.children.forEach((subscriptionRes) => {
            subscriptionRes.meta = {
              conName: conRes.name,
              numOfPayloads: 0,
              parentRes: db,
            };
          });
        }
        stateStorage.resetResource(conRes.name, dbRes);
      }
      conRes.isConnected = true;
    } catch (e) {
      showWindowErrorMessage(e);
      conRes.isInProgress = false;
    }
    dbResourceTree.changeConnectionTreeData(conRes);
  });

  commands.registerCommand(DISCONNECT, async (conRes: DbConnection) => {
    try {
      log(`Disconnect ${conRes.name}`);
      conRes.isInProgress = true;
      dbResourceTree.changeConnectionTreeData(conRes);
      const setting = await stateStorage.getConnectionSettingByName(conRes.name);
      if (!setting) {
        return;
      }
      const message = await MqttDriverManager.end(setting);
      conRes.isConnected = false;
      if (message) {
        showWindowErrorMessage(message);
        return;
      }
      stateStorage.resetResource(conRes.name, []);
      conRes.isInProgress = false;
    } catch (e) {
      console.error(e);
      showWindowErrorMessage(e);
      conRes.isInProgress = false;
    }
    dbResourceTree.changeConnectionTreeData(conRes);
  });

  commands.registerCommand(ADD_SUBSCRIPTION, async (dbRes: MqttDatabase) => {
    SubscriptionSettingPanel.render(context.extensionUri, {
      isNew: true,
      dbRes,
    });
  });

  commands.registerCommand(EDIT_SUBSCRIPTION, async (subscriptionRes: DbSubscription) => {
    const { parentRes } = subscriptionRes.meta;
    SubscriptionSettingPanel.render(context.extensionUri, {
      isNew: false,
      subscriptionRes,
      dbRes: parentRes,
    });
  });

  commands.registerCommand(REMOVE_SUBSCRIPTION, async (subscriptionRes: DbSubscription) => {
    try {
      const { conName, parentRes } = subscriptionRes.meta;
      const setting = await stateStorage.getConnectionSettingByName(conName);
      if (!setting || !setting.mqttSetting || !setting.mqttSetting.subscriptionList) {
        return;
      }
      const answer = await window.showInformationMessage(
        `Are you sure to delete subscription(${subscriptionRes.name})?`,
        "YES",
        "NO"
      );
      if (answer !== "YES") {
        return;
      }

      const manager = MqttDriverManager.getInstance(setting);

      const idx = setting.mqttSetting.subscriptionList.findIndex(
        (it) => it.name === subscriptionRes.name
      );
      if (idx >= 0) {
        setting.mqttSetting.subscriptionList.splice(idx, 1);
      }
      await stateStorage.editConnectionSetting(setting);
      await manager.removeSubscription(parentRes, subscriptionRes);
    } catch (e) {
      showWindowErrorMessage(e);
      return;
    }
  });

  commands.registerCommand(SUBSCRIBE, async (subscriptionRes: DbSubscription) => {
    const { conName } = subscriptionRes.meta;
    const setting = await stateStorage.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }
    const manager = MqttDriverManager.getInstance(setting);
    await manager.subscribe(subscriptionRes);
  });

  commands.registerCommand(UNSUBSCRIBE, async (subscriptionRes: DbSubscription) => {
    const { conName } = subscriptionRes.meta;
    const setting = await stateStorage.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }
    const manager = MqttDriverManager.getInstance(setting);
    await manager.unsubscribe(subscriptionRes);
  });

  // Show publish editor panel
  context.subscriptions.push(
    commands.registerCommand(SHOW_PUBLISH_EDITOR_PANEL, async (subscriptionRes: DbSubscription) => {
      PublishEditorPanel.render(context.extensionUri, subscriptionRes);
    })
  );

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
    commands.registerCommand(OPEN_CHAT_2_QUERY, async (schemaRes: DbSchema) => {
      const { conName } = schemaRes.meta;
      const setting = await stateStorage.getConnectionSettingByName(conName);
      if (!setting) {
        return;
      }

      Chat2QueryPanel.render(context.extensionUri, conName, schemaRes);
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
        commands.executeCommand(LOAD_DB_SCHEMA, conRes);
      });
    })
  );

  // Show scan panel
  context.subscriptions.push(
    commands.registerCommand(SHOW_SCAN_PANEL, async (target: DbResource) => {
      ScanPanel.render(context.extensionUri, target);
    })
  );

  // Show dynamo query panel
  context.subscriptions.push(
    commands.registerCommand(SHOW_DYNAMO_QUERY_PANEL, async (target: DbDynamoTable) => {
      DynamoQueryPanel.render(context.extensionUri, target);
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
