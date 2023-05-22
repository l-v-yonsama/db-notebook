import {
  ExtensionContext,
  NotebookCellData,
  NotebookCellKind,
  commands,
  window,
  workspace,
} from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import {
  DBDriverResolver,
  DbConnection,
  DbResource,
  DbTable,
  RDSBaseDriver,
  RedisDriver,
  displayGeneralColumnType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResourceTreeProvider } from "./ResourceTreeProvider";
import { MdhPanel } from "../panels/MdhPanel";
import { ScanPanel } from "../panels/ScanPanel";
import {
  CLONE_CONNECTION_SETTING,
  CREATE_CONNECTION_SETTING,
  CREATE_ER_DIAGRAM,
  CREATE_NEW_NOTEBOOK,
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

  // ER diagram
  commands.registerCommand(CREATE_ER_DIAGRAM, async (tableRes: DbTable) => {
    try {
      const content = createErDiagram(tableRes);
      const cell = new NotebookCellData(NotebookCellKind.Markup, content, "markdown");
      commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
    } catch (e: any) {
      window.showErrorMessage(e.message);
    }
  });
};

function createErDiagram(tableRes: DbTable) {
  let text = "```mermaid\nerDiagram\n\n";

  // users ||--o{ articles: ""

  text += `${tableRes.name} {\n`;
  tableRes.children.forEach((columnRes) => {
    let pkOrFk = "";
    if (columnRes.primaryKey) {
      pkOrFk = "PK ";
    } else if (tableRes.foreignKeys?.referenceTo?.[columnRes.name]) {
      pkOrFk = "FK ";
    }
    let comment = "";
    if (columnRes.comment) {
      comment = `"${columnRes.comment}"`;
    }
    text += `  ${displayGeneralColumnType(columnRes.colType)} ${
      columnRes.name
    } ${pkOrFk}${comment}\n`;
  });
  text += `}\n`;
  // users {
  //   string name
  //   string email
  //   integer age
  // }

  // articles {
  //   string title
  //   text text
  // }
  text += "```\n";
  return text;
}
