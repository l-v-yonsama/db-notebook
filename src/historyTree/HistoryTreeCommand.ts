import { ExtensionContext, NotebookCellData, NotebookCellKind, commands, window } from "vscode";
import { StateStorage } from "../utilities/StateStorage";

import {
  CREATE_NEW_NOTEBOOK,
  DELETE_ALL_SQL_HISTORY,
  DELETE_SQL_HISTORY,
  EXECUTE_SQL_HISTORY,
  OPEN_SQL_HISTORY,
  REFRESH_SQL_HISTORIES,
} from "../constant";

import { HistoryTreeProvider } from "./HistoryTreeProvider";
import { SQLHistory } from "../types/SQLHistory";
import {
  DBDriverResolver,
  RDSBaseDriver,
  ResultSetData,
  normalizeQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { log } from "../utilities/logger";
import { MdhPanel } from "../panels/MdhPanel";

type HistoryTreeParams = {
  context: ExtensionContext;
  stateStorage: StateStorage;
  historyTreeProvider: HistoryTreeProvider;
};

const PREFIX = "  [notebook/History]";

export const registerHistoryTreeCommand = (params: HistoryTreeParams) => {
  const { context, stateStorage, historyTreeProvider } = params;

  context.subscriptions.push(
    commands.registerCommand(REFRESH_SQL_HISTORIES, () => {
      historyTreeProvider.refresh(true);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(DELETE_ALL_SQL_HISTORY, async () => {
      const answer = await window.showInformationMessage(
        `Are you sure to delete all sql histories?`,
        "YES",
        "NO"
      );
      if (answer !== "YES") {
        return;
      }

      await stateStorage.deleteAllSQLHistories();
      historyTreeProvider.refresh(true);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(DELETE_SQL_HISTORY, async (history: SQLHistory) => {
      const answer = await window.showInformationMessage(
        `Are you sure to delete this history? ${history.sqlDoc}`,
        "YES",
        "NO"
      );
      if (answer !== "YES") {
        return;
      }

      await stateStorage.deleteSQLHistoryByID(history.id);
      historyTreeProvider.refresh(true);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(OPEN_SQL_HISTORY, async (history: SQLHistory) => {
      const cells: NotebookCellData[] = [];
      if (history.variables && Object.keys(history.variables).length > 0) {
        cells.push(
          new NotebookCellData(
            NotebookCellKind.Code,
            JSON.stringify(history.variables, null, 2),
            "json"
          )
        );
      }

      const sqlCell = new NotebookCellData(NotebookCellKind.Code, history.sqlDoc, "sql");
      sqlCell.metadata = {
        connectionName: history.connectionName,
      };
      cells.push(sqlCell);

      commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
    })
  );

  context.subscriptions.push(
    commands.registerCommand(EXECUTE_SQL_HISTORY, async (history: SQLHistory) => {
      const connectionSetting = await stateStorage.getConnectionSettingByName(
        history.connectionName
      );
      if (!connectionSetting) {
        window.showErrorMessage("Missing connection " + history.connectionName);
        await stateStorage.deleteSQLHistoryByID(history.id);
        historyTreeProvider.refresh(true);
        return;
      }

      const resolver = DBDriverResolver.getInstance();
      const toPositionedParameter = resolver
        .createDriver<RDSBaseDriver>(connectionSetting)
        .isPositionedParameterAvailable();
      const { query, binds } = normalizeQuery({
        query: history.sqlDoc,
        bindParams: history.variables ?? {},
        toPositionedParameter,
      });
      log(`${PREFIX} query:` + query);
      log(`${PREFIX} binds:` + JSON.stringify(binds));

      const { ok, message, result } = await resolver.workflow<RDSBaseDriver, ResultSetData>(
        connectionSetting,
        async (driver) => {
          return await driver.requestSql({
            sql: query,
            conditions: {
              binds,
            },
          });
        }
      );
      if (ok && result) {
        MdhPanel.render(context.extensionUri, result.meta.tableName ?? "History", [result]);
      } else {
        window.showErrorMessage(`Execute query Error: ${message}`);
      }
    })
  );
};
