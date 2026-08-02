import {
  ExtensionContext,
  NotebookCellData,
  NotebookCellKind,
  NotebookEdit,
  ProgressLocation,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";
import dayjs from "dayjs";
import { StateStorage } from "../../utilities/StateStorage";

import {
  APPEND_SQL_HISTORIES_TO_ACTIVE_NOTEBOOK,
  CLEAR_SQL_HISTORIES_CONNECTION_FILTER,
  CREATE_NEW_NOTEBOOK,
  DELETE_ALL_SQL_HISTORY,
  DELETE_SQL_HISTORY,
  EXECUTE_SQL_HISTORY,
  FILTER_SQL_HISTORIES_BY_CONNECTION,
  NOTEBOOK_TYPE,
  OPEN_MDH_VIEWER,
  OPEN_SQL_HISTORIES_AS_NOTEBOOK,
  OPEN_SQL_HISTORY,
  REFRESH_SQL_HISTORIES,
} from "../../constant";

import {
  RDSBaseDriver,
  normalizeQuery,
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData, resolveCodeLabel } from "@l-v-yonsama/rdh";
import { CellMeta } from "../../types/Notebook";
import { SQLHistory } from "../../types/SQLHistory";
import { MdhViewParams } from "../../types/views";
import { showWindowErrorMessage } from "../../utilities/alertUtil";
import { createRDSDriver, workflow } from "../../utilities/driverResolver";
import { existsFileOnWorkspace } from "../../utilities/fsUtil";
import { log } from "../../utilities/logger";
import { readCodeResolverFile, readRuleFile } from "../../utilities/notebookUtil";
import { HistoryTreeProvider } from "./HistoryTreeProvider";

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

  const createProvenanceMarkdownCellByHistory = (history: SQLHistory) => {
    const parts = [history.connectionName];
    if (history.executedAt) {
      parts.push(dayjs(history.executedAt).format("YYYY-MM-DD HH:mm"));
    }
    if (history.status === "error") {
      parts.push("error");
    } else if (history.meta?.type === "select" && history.summary?.selectedRows !== undefined) {
      parts.push(`${history.summary.selectedRows} rows`);
    } else if (history.meta?.type !== "select" && history.summary?.affectedRows !== undefined) {
      parts.push(`${history.summary.affectedRows} affected rows`);
    }
    return new NotebookCellData(
      NotebookCellKind.Markup,
      `_From SQL history: ${parts.join(" ・ ")}_`,
      "markdown"
    );
  };

  const createNotebookCellsByHistories = (histories: SQLHistory[]): NotebookCellData[] => {
    const cells: NotebookCellData[] = [];
    for (const history of histories) {
      cells.push(createProvenanceMarkdownCellByHistory(history));
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
    }
    return cells;
  };

  const resolveSelectedHistories = (
    history: SQLHistory,
    selectedHistories?: SQLHistory[]
  ): SQLHistory[] => (selectedHistories && selectedHistories.length > 0 ? selectedHistories : [history]);

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

  registerDisposableCommand(
    OPEN_SQL_HISTORIES_AS_NOTEBOOK,
    async (history: SQLHistory, selectedHistories?: SQLHistory[]) => {
      const histories = resolveSelectedHistories(history, selectedHistories);
      const cells = createNotebookCellsByHistories(histories);
      commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
    }
  );

  registerDisposableCommand(
    APPEND_SQL_HISTORIES_TO_ACTIVE_NOTEBOOK,
    async (history: SQLHistory, selectedHistories?: SQLHistory[]) => {
      const activeEditor = window.activeNotebookEditor;
      if (!activeEditor || activeEditor.notebook.notebookType !== NOTEBOOK_TYPE) {
        showWindowErrorMessage("No active notebook editor found.");
        return;
      }

      const histories = resolveSelectedHistories(history, selectedHistories);
      const cells = createNotebookCellsByHistories(histories);
      const edit = new WorkspaceEdit();
      const notebookEdit = NotebookEdit.insertCells(activeEditor.selection.end, cells);
      edit.set(activeEditor.notebook.uri, [notebookEdit]);
      await workspace.applyEdit(edit);
    }
  );

  registerDisposableCommand(FILTER_SQL_HISTORIES_BY_CONNECTION, async () => {
    const showAllLabel = "$(list-flat) Show all connections";
    const connectionNames = historyTreeProvider.getConnectionNames();
    const picked = await window.showQuickPick([showAllLabel, ...connectionNames], {
      placeHolder: "Filter SQL histories by connection",
    });
    if (picked === undefined) {
      return;
    }
    historyTreeProvider.setConnectionFilter(picked === showAllLabel ? undefined : picked);
  });

  registerDisposableCommand(CLEAR_SQL_HISTORIES_CONNECTION_FILTER, () => {
    historyTreeProvider.setConnectionFilter(undefined);
  });

  registerDisposableCommand(EXECUTE_SQL_HISTORY, async (history: SQLHistory) => {
    if (history.status === "error") {
      showWindowErrorMessage(
        "This SQL previously failed and cannot be re-executed from history. Open it in a notebook to fix and run it."
      );
      return;
    }

    const connectionSetting = await stateStorage.getConnectionSettingByName(history.connectionName);
    if (!connectionSetting) {
      showWindowErrorMessage("Missing connection " + history.connectionName);
      await stateStorage.deleteSQLHistoryByID(history.id);
      historyTreeProvider.refresh(true);
      return;
    }

    const driver = await createRDSDriver(connectionSetting, true);
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

        const r = await workflow<RDSBaseDriver, ResultSetData>(
          connectionSetting,
          async (driver) => {
            driverForKill = driver;
            return await driver.requestSql({
              sql: query,
              conditions: {
                binds,
              },
              prepare: history.meta?.useDatabase
                ? { useDatabaseName: history.meta.useDatabase }
                : undefined,
            });
          },
          true
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
