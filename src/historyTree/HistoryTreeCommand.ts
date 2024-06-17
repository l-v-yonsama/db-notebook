import {
  ExtensionContext,
  NotebookCellData,
  NotebookCellKind,
  ProgressLocation,
  commands,
  window,
} from "vscode";
import { StateStorage } from "../utilities/StateStorage";

import {
  CREATE_NEW_NOTEBOOK,
  DELETE_ALL_SQL_HISTORY,
  DELETE_SQL_HISTORY,
  EXECUTE_SQL_HISTORY,
  OPEN_MDH_VIEWER,
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
  resolveCodeLabel,
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { log } from "../utilities/logger";
import { MdhViewParams } from "../types/views";
import { CellMeta } from "../types/Notebook";
import { existsFileOnWorkspace } from "../utilities/fsUtil";
import { readCodeResolverFile, readRuleFile } from "../utilities/notebookUtil";
import { showWindowErrorMessage } from "../utilities/alertUtil";

type HistoryTreeParams = {
  context: ExtensionContext;
  stateStorage: StateStorage;
  historyTreeProvider: HistoryTreeProvider;
};

const PREFIX = "  [notebook/History]";

export const registerHistoryTreeCommand = (params: HistoryTreeParams) => {
  const { context, stateStorage, historyTreeProvider } = params;

  const registerDisposableCommand = (
    command: string,
    callback: (...args: any[]) => any,
    thisArg?: any
  ) => {
    const disposable = commands.registerCommand(command, callback, thisArg);
    context.subscriptions.push(disposable);
  };

  const createNotebookSqlCellByHistory = (history: SQLHistory) => {
    const sqlCell = new NotebookCellData(NotebookCellKind.Code, history.sqlDoc, "sql");
    const metadata: CellMeta = {
      connectionName: history.connectionName,
    };
    if (history.codeResolverFile) {
      metadata.codeResolverFile = history.codeResolverFile;
    }
    if (history.ruleFile) {
      metadata.ruleFile = history.ruleFile;
    }
    sqlCell.metadata = metadata;
    return sqlCell;
  };

  registerDisposableCommand(REFRESH_SQL_HISTORIES, () => {
    historyTreeProvider.refresh(true);
  });

  registerDisposableCommand(DELETE_ALL_SQL_HISTORY, async () => {
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
  });

  registerDisposableCommand(DELETE_SQL_HISTORY, async (history: SQLHistory) => {
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
  });

  registerDisposableCommand(OPEN_SQL_HISTORY, async (history: SQLHistory) => {
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

    cells.push(createNotebookSqlCellByHistory(history));

    commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
  });

  registerDisposableCommand(EXECUTE_SQL_HISTORY, async (history: SQLHistory) => {
    const connectionSetting = await stateStorage.getConnectionSettingByName(history.connectionName);
    if (!connectionSetting) {
      showWindowErrorMessage("Missing connection " + history.connectionName);
      await stateStorage.deleteSQLHistoryByID(history.id);
      historyTreeProvider.refresh(true);
      return;
    }

    const resolver = DBDriverResolver.getInstance();
    const driver = resolver.createDriver<RDSBaseDriver>(connectionSetting);
    const toPositionedParameter = driver.isPositionedParameterAvailable();
    const toPositionalCharacter = driver.getPositionalCharacter();
    const { query, binds } = normalizeQuery({
      query: history.sqlDoc,
      bindParams: history.variables ?? {},
      toPositionedParameter,
      toPositionalCharacter,
    });
    log(`${PREFIX} query:` + query);
    log(`${PREFIX} binds:` + JSON.stringify(binds));

    const { ok, message, result } = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        let driverForKill: RDSBaseDriver | undefined = undefined;

        token.onCancellationRequested(() => {
          driverForKill?.kill();
        });

        progress.report({
          message: `Execute query: ${query}`,
          increment: 50,
        });

        const r = await resolver.workflow<RDSBaseDriver, ResultSetData>(
          connectionSetting,
          async (driver) => {
            driverForKill = driver;
            return await driver.requestSql({
              sql: query,
              conditions: {
                binds,
              },
            });
          }
        );
        progress.report({
          message: `Completed.`,
          increment: 50,
        });
        return r;
      }
    );

    if (ok && result) {
      const cell = createNotebookSqlCellByHistory(history);

      if (cell.metadata && history.ruleFile && (await existsFileOnWorkspace(history.ruleFile))) {
        const rrule = await readRuleFile(cell.metadata, result);
        if (rrule) {
          result.meta.tableRule = rrule.tableRule;

          try {
            await runRuleEngine(result);
          } catch (e) {
            throw new Error(
              `RuleEngineError:${(e as Error).message}. Unuse or review the following file. ${
                history.ruleFile
              }`
            );
          }
        }
      }

      if (
        cell.metadata &&
        history.codeResolverFile &&
        (await existsFileOnWorkspace(history.codeResolverFile))
      ) {
        const codeResolver = await readCodeResolverFile(cell.metadata);
        if (codeResolver) {
          result.meta.codeItems = codeResolver.items;
          await resolveCodeLabel(result);
        }
      }

      const commandParam: MdhViewParams = {
        title: result.meta.tableName ?? "History",
        list: [result],
      };
      commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
    } else {
      showWindowErrorMessage(`Execute query Error: ${message}`);
    }
  });
};
