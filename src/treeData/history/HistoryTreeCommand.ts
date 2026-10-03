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
  APPEND_QUERY_HISTORIES_TO_ACTIVE_NOTEBOOK,
  CLEAR_QUERY_HISTORIES_CONNECTION_FILTER,
  CREATE_NEW_NOTEBOOK,
  DELETE_ALL_QUERY_HISTORY,
  DELETE_QUERY_HISTORY,
  EXECUTE_QUERY_HISTORY,
  FILTER_QUERY_HISTORIES_BY_CONNECTION,
  FOCUS_QUERY_HISTORIES_FILTER,
  HISTORY_VIEW_ID,
  NOTEBOOK_TYPE,
  OPEN_DYNAMO_QUERY_PANEL_FROM_HISTORY,
  OPEN_MDH_VIEWER,
  OPEN_QUERY_HISTORIES_AS_NOTEBOOK,
  REFRESH_QUERY_HISTORIES,
  RESET_QUERY_HISTORY_PERFORMANCE,
  SORT_QUERY_HISTORIES_BY_DURATION,
  SORT_QUERY_HISTORIES_BY_RECENT,
  START_PERFORMANCE_TUNING_FROM_HISTORY,
} from "../../constant";

import {
  AwsDriver,
  BaseSQLSupportDriver,
  ConnectionSetting,
  DBType,
  DbDynamoTable,
  DynamoDbWorkloadContext,
  RDSBaseDriver,
  RdsDatabase,
  ResourceType,
  SelectedStatementStatistics,
  estimateBindParameters,
  normalizeQuery,
  resolveTableAliasMap,
  resolveTargetTables,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData, resolveCodeLabel } from "@l-v-yonsama/rdh";
import { CellMeta } from "../../types/Notebook";
import { QueryHistory } from "../../types/QueryHistory";
import { MdhViewParams } from "../../types/views";
import { showWindowErrorMessage } from "../../utilities/alertUtil";
import { createRDSDriver, createSQLSupportDriver, workflow } from "../../utilities/driverResolver";
import { existsFileOnWorkspace } from "../../utilities/fsUtil";
import { log } from "../../utilities/logger";
import { readCodeResolverFile } from "../../utilities/notebookUtil";
import { buildObservationFromHistory } from "./dynamoDbHistoryObservation";
import type { DynamoDbPerformanceTuningPreviewRequest } from "../../performanceTuning/preview/dynamoDbPerformanceTuningPreview";
import {
  openDynamoDbPerformanceTuningPreview,
  openPerformanceTuningPreview,
} from "../../performanceTuning/preview/performanceTuningBindConfirmation";
import { averageCapacityUnits, averageElapsedTimeMilli } from "../../utilities/queryHistoryUtil";
import { HistoryTreeProvider } from "./HistoryTreeProvider";
import { DynamoQueryPanel } from "../../panels/DynamoQueryPanel";

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

  const createNotebookSqlCellByHistory = (history: QueryHistory) => {
    const sqlCell = new NotebookCellData(NotebookCellKind.Code, history.sqlDoc, "sql");
    const metadata: CellMeta = {
      connectionName: history.connectionName,
    };
    if (history.codeResolverFile) {
      metadata.codeResolverFile = history.codeResolverFile;
    }
    sqlCell.metadata = metadata;
    return sqlCell;
  };

  const createProvenanceMarkdownCellByHistory = (history: QueryHistory) => {
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
      `_From Query History: ${parts.join(" ・ ")}_`,
      "markdown"
    );
  };

  const createNotebookCellsForHistory = (history: QueryHistory): NotebookCellData[] => {
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
    return cells;
  };

  const createNotebookCellsByHistories = (histories: QueryHistory[]): NotebookCellData[] => {
    const cells: NotebookCellData[] = [];
    for (const history of histories) {
      cells.push(createProvenanceMarkdownCellByHistory(history));
      cells.push(...createNotebookCellsForHistory(history));
    }
    return cells;
  };

  const resolveSelectedHistories = (
    history: QueryHistory,
    selectedHistories?: QueryHistory[]
  ): QueryHistory[] =>
    (selectedHistories && selectedHistories.length > 0 ? selectedHistories : [history]).filter(
      (item) => item.request?.kind !== "dynamodbQuery"
    );

  registerDisposableCommand(REFRESH_QUERY_HISTORIES, () => {
    historyTreeProvider.refresh(true);
  });

  registerDisposableCommand(DELETE_ALL_QUERY_HISTORY, async () => {
    const answer = await window.showInformationMessage(
      `Are you sure to delete all query histories?`,
      "YES",
      "NO"
    );
    if (answer !== "YES") {
      return;
    }

    await stateStorage.deleteAllQueryHistories();
    historyTreeProvider.refresh(true);
  });

  registerDisposableCommand(DELETE_QUERY_HISTORY, async (history: QueryHistory) => {
    const answer = await window.showInformationMessage(
      `Are you sure to delete this history? ${history.sqlDoc}`,
      "YES",
      "NO"
    );
    if (answer !== "YES") {
      return;
    }

    await stateStorage.deleteQueryHistoryByID(history.id);
    historyTreeProvider.refresh(true);
  });

  registerDisposableCommand(RESET_QUERY_HISTORY_PERFORMANCE, async (history: QueryHistory) => {
    const answer = await window.showWarningMessage(
      "Reset the accumulated performance statistics for this Query History item? The statement, bind values, and latest result remain available. New executions start a new measurement period.",
      { modal: true },
      "Reset"
    );
    if (answer !== "Reset") {
      return;
    }
    await stateStorage.resetQueryHistoryPerformanceByID(history.id);
    await historyTreeProvider.refresh(true);
    window.showInformationMessage(
      "Performance statistics were reset. Save a baseline report before resetting when you need to retain the previous evidence."
    );
  });

  registerDisposableCommand(
    OPEN_QUERY_HISTORIES_AS_NOTEBOOK,
    async (history: QueryHistory, selectedHistories?: QueryHistory[]) => {
      const histories = resolveSelectedHistories(history, selectedHistories);
      if (histories.length === 0) {
        return;
      }
      const cells = createNotebookCellsByHistories(histories);
      commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
    }
  );

  registerDisposableCommand(
    APPEND_QUERY_HISTORIES_TO_ACTIVE_NOTEBOOK,
    async (history: QueryHistory, selectedHistories?: QueryHistory[]) => {
      const histories = resolveSelectedHistories(history, selectedHistories);
      if (histories.length === 0) {
        return;
      }
      const activeEditor = window.activeNotebookEditor;
      if (!activeEditor || activeEditor.notebook.notebookType !== NOTEBOOK_TYPE) {
        showWindowErrorMessage("No active notebook editor found.");
        return;
      }

      const cells = createNotebookCellsByHistories(histories);
      const edit = new WorkspaceEdit();
      const notebookEdit = NotebookEdit.insertCells(activeEditor.selection.end, cells);
      edit.set(activeEditor.notebook.uri, [notebookEdit]);
      await workspace.applyEdit(edit);
    }
  );

  registerDisposableCommand(FILTER_QUERY_HISTORIES_BY_CONNECTION, async () => {
    const showAllLabel = "$(list-flat) Show all connections";
    const connectionNames = historyTreeProvider.getConnectionNames();
    const picked = await window.showQuickPick([showAllLabel, ...connectionNames], {
      placeHolder: "Filter query histories by connection",
    });
    if (picked === undefined) {
      return;
    }
    historyTreeProvider.setConnectionFilter(picked === showAllLabel ? undefined : picked);
  });

  registerDisposableCommand(CLEAR_QUERY_HISTORIES_CONNECTION_FILTER, () => {
    historyTreeProvider.setConnectionFilter(undefined);
  });

  // Query-content search reuses VS Code's built-in tree find/filter widget,
  // the same way database-notebook.focus-filter does for the connections
  // view: focus the view, then let "list.find" take over.
  registerDisposableCommand(FOCUS_QUERY_HISTORIES_FILTER, async () => {
    await commands.executeCommand(`${HISTORY_VIEW_ID}.focus`);
    await commands.executeCommand("list.find");
  });

  registerDisposableCommand(SORT_QUERY_HISTORIES_BY_DURATION, () => {
    historyTreeProvider.setSortOrder("duration");
  });

  registerDisposableCommand(SORT_QUERY_HISTORIES_BY_RECENT, () => {
    historyTreeProvider.setSortOrder("recent");
  });

  registerDisposableCommand(OPEN_DYNAMO_QUERY_PANEL_FROM_HISTORY, async (history: QueryHistory) => {
    const request = history.request;
    if (request?.kind !== "dynamodbQuery" || request.origin !== "dynamoQueryPanel") {
      showWindowErrorMessage("This history entry was not created by DynamoDB Query Panel.");
      return;
    }
    const tableName = request.input.TableName;
    if (!tableName) {
      showWindowErrorMessage("The saved DynamoDB Query does not contain a table name.");
      return;
    }

    const findTable = (databases: ReturnType<StateStorage["getResourceByName"]>) =>
      databases
        ?.flatMap((database) =>
          database.findChildren<DbDynamoTable>({ resourceType: ResourceType.DynamoTable })
        )
        .find((table) => table.name === tableName);

    let databases = stateStorage.getResourceByName(history.connectionName);
    let tableRes = findTable(databases);
    if (!tableRes) {
      // Refresh a stale cached resource tree once so a recently recreated
      // table can be opened without requiring a manual tree refresh first.
      const loaded = await stateStorage.loadResource(
        history.connectionName,
        databases !== undefined,
        true
      );
      if (!loaded.ok || !loaded.result) {
        showWindowErrorMessage(
          loaded.message || `Could not load DynamoDB resources for ${history.connectionName}.`
        );
        return;
      }
      databases = loaded.result.db;
      tableRes = findTable(databases);
    }
    if (!tableRes) {
      showWindowErrorMessage(
        `DynamoDB table '${tableName}' was not found in connection '${history.connectionName}'.`
      );
      return;
    }

    try {
      await DynamoQueryPanel.render(context.extensionUri, tableRes, request.input);
    } catch (error) {
      showWindowErrorMessage(error);
    }
  });

  // Native Query history executes its stored input; sqlDoc is display text only.
  const executeDynamoQueryHistory = async (
    connectionSetting: ConnectionSetting,
    history: QueryHistory,
    request: Extract<NonNullable<QueryHistory["request"]>, { kind: "dynamodbQuery" }>
  ): Promise<void> => {
    log(`${PREFIX} native Query:` + JSON.stringify(request.input));

    const { ok, message, result } = await window.withProgress(
      { location: ProgressLocation.Notification, cancellable: false },
      async (progress) => {
        progress.report({
          message: `Execute DynamoDB Query: ${request.displayText}`,
          increment: 50,
        });
        const r = await workflow<AwsDriver, ResultSetData>(
          connectionSetting,
          async (driver) => driver.dynamoClient.queryItemsAtClient(request.input),
          true
        );
        progress.report({ message: `Completed.`, increment: 50 });
        return r;
      }
    );

    if (ok && result) {
      const commandParam: MdhViewParams = {
        title: result.meta.tableName ?? "History",
        list: [result],
      };
      commands.executeCommand(OPEN_MDH_VIEWER, commandParam);

      await stateStorage.addQueryHistory({
        connectionName: history.connectionName,
        sqlDoc: request.displayText,
        request,
        meta: result.meta,
        summary: result.summary,
        executedAt: Date.now(),
        status: "success",
      });
    } else {
      showWindowErrorMessage(`Execute query Error: ${message}`);

      await stateStorage.addQueryHistory({
        connectionName: history.connectionName,
        sqlDoc: request.displayText,
        request,
        executedAt: Date.now(),
        status: "error",
        errorMessage: message,
      });
    }
    historyTreeProvider.refresh(true);
  };

  registerDisposableCommand(EXECUTE_QUERY_HISTORY, async (history: QueryHistory) => {
    const connectionSetting = await stateStorage.getConnectionSettingByName(history.connectionName);
    if (!connectionSetting) {
      showWindowErrorMessage("Missing connection " + history.connectionName);
      await stateStorage.deleteQueryHistoryByID(history.id);
      historyTreeProvider.refresh(true);
      return;
    }

    if (history.request?.kind === "dynamodbQuery") {
      await executeDynamoQueryHistory(connectionSetting, history, history.request);
      return;
    }

    // A PartiQL history entry is dbType:Aws with request.kind "sql", so it has
    // to resolve through the SQL-support driver - createRDSDriver() rejects
    // Aws outright ("Aws is not a relational database"). This mirrors how the
    // notebook's own SQL kernel executes the same statement.
    const driver = await createSQLSupportDriver(connectionSetting, true);
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
        let driverForKill: BaseSQLSupportDriver | undefined = undefined;

        token.onCancellationRequested(() => {
          driverForKill?.kill();
        });

        progress.report({
          message: `Execute query: ${query}`,
          increment: 50,
        });

        const r = await workflow<BaseSQLSupportDriver, ResultSetData>(
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

      await stateStorage.addQueryHistory({
        connectionName: history.connectionName,
        sqlDoc: history.sqlDoc,
        variables: history.variables,
        meta: result.meta,
        summary: result.summary,
        codeResolverFile: history.codeResolverFile,
        executedAt: Date.now(),
        status: "success",
      });
      historyTreeProvider.refresh(true);
    } else {
      showWindowErrorMessage(`Execute query Error: ${message}`);

      await stateStorage.addQueryHistory({
        connectionName: history.connectionName,
        sqlDoc: history.sqlDoc,
        variables: history.variables,
        codeResolverFile: history.codeResolverFile,
        executedAt: Date.now(),
        status: "error",
        errorMessage: message,
      });
      historyTreeProvider.refresh(true);
    }
  });

  // DynamoDB preview collection avoids RDB-only metadata and item-data reads.
  const startDynamoDbPerformanceTuningFromHistory = async (
    connectionSetting: ConnectionSetting,
    history: QueryHistory
  ): Promise<void> => {
    // Native Query values remain execution-only and are sanitized before Context creation.
    let request: DynamoDbPerformanceTuningPreviewRequest["statement"]["request"];
    if (history.request?.kind === "dynamodbQuery") {
      request = { kind: "query", input: history.request.input };
    } else {
      // Convert canonical named binds to DynamoDB positional markers.
      const driver = await createSQLSupportDriver<AwsDriver>(connectionSetting, true);
      const toPositionedParameter = driver.isPositionedParameterAvailable();
      const toPositionalCharacter = driver.getPositionalCharacter();
      const nativeSql = normalizeQuery({
        query: history.sqlDoc,
        toPositionedParameter,
        toPositionalCharacter,
      }).query;
      request = { kind: "partiql", text: nativeSql };
    }

    // Workload aggregates repeated history samples; previousObservation below is one execution.
    const dynamoDbPerf = history.performance?.dynamoDb;
    const workload: DynamoDbWorkloadContext | undefined =
      history.performance && history.performance.sampleCount > 0
        ? {
            executionCount: history.performance.sampleCount,
            totalClientElapsedTimeMs: history.performance.totalElapsedTimeMilli,
            averageClientElapsedTimeMs: averageElapsedTimeMilli(history.performance),
            maxClientElapsedTimeMs: history.performance.maxElapsedTimeMilli,
            lastClientElapsedTimeMs: history.performance.lastElapsedTimeMilli,
            capacitySampleCount: history.performance.capacitySampleCount,
            totalCapacityUnits: history.performance.totalCapacityUnits,
            averageCapacityUnits: averageCapacityUnits(history.performance),
            maxCapacityUnits: history.performance.maxCapacityUnits,
            lastCapacityUnits: history.performance.lastCapacityUnits,
            lastReturnedItemCount:
              history.summary?.dynamoDb?.returnedItemCount ?? history.summary?.selectedRows,
            lastEvaluatedItemCount: history.summary?.dynamoDb?.evaluatedItemCount,
            source: "sqlHistory",
            lastExecutedAt: history.executedAt
              ? new Date(history.executedAt).toISOString()
              : undefined,
            readObservationSampleCount: dynamoDbPerf?.observationSampleCount,
            evaluatedCountSampleCount: dynamoDbPerf?.evaluatedCountSampleCount,
            totalReturnedItemCount: dynamoDbPerf?.totalReturnedItemCount,
            totalEvaluatedItemCount: dynamoDbPerf?.totalEvaluatedItemCount,
            weightedFilterPassRate:
              dynamoDbPerf && dynamoDbPerf.totalEvaluatedItemCount > 0
                ? dynamoDbPerf.totalReturnedItemCount / dynamoDbPerf.totalEvaluatedItemCount
                : undefined,
            minFilterPassRate: dynamoDbPerf?.minFilterPassRate,
            maxFilterPassRate: dynamoDbPerf?.maxFilterPassRate,
            lastFilterPassRate: dynamoDbPerf?.lastFilterPassRate,
            boundedObservationCount: dynamoDbPerf?.boundedObservationCount,
          }
        : undefined;

    const previousObservation = buildObservationFromHistory(history);

    const result = await openDynamoDbPerformanceTuningPreview({
      extensionUri: context.extensionUri,
      connectionSetting,
      initialMaskingLevel: stateStorage.getAiMaskingLevelForConnection(connectionSetting.name),
      statement: { source: "sqlHistory", request, previousObservation },
      workload,
    });

    if (result.status === "failed") {
      showWindowErrorMessage(
        [result.message, result.technicalMessage].filter(Boolean).join(" ") ||
          "Failed to collect DynamoDB performance tuning context."
      );
    }
  };

  registerDisposableCommand(START_PERFORMANCE_TUNING_FROM_HISTORY, async (history: QueryHistory) => {
    const connectionSetting = await stateStorage.getConnectionSettingByName(history.connectionName);
    if (!connectionSetting) {
      showWindowErrorMessage("Missing connection " + history.connectionName);
      return;
    }

    if (connectionSetting.dbType === DBType.Aws) {
      await startDynamoDbPerformanceTuningFromHistory(connectionSetting, history);
      return;
    }

    // Prefer the per-history "USE <database>" override, falling back to the
    // connection's own default database. If neither is known, databaseName
    // can't be determined safely - fail closed rather than guessing which
    // database the plan/statistics should be collected against.
    const databaseName = history.meta?.useDatabase ?? connectionSetting.database;
    if (!databaseName) {
      showWindowErrorMessage("Could not determine the target database for this query history entry.");
      return;
    }

    const statistics: SelectedStatementStatistics | undefined =
      history.performance && history.performance.sampleCount > 0
        ? {
            executionCount: history.performance.sampleCount,
            totalElapsedTimeMs: history.performance.totalElapsedTimeMilli,
            averageElapsedTimeMs:
              history.performance.totalElapsedTimeMilli / history.performance.sampleCount,
            maxElapsedTimeMs: history.performance.maxElapsedTimeMilli,
            statisticsSince: history.performance.statisticsSince
              ? new Date(history.performance.statisticsSince).toISOString()
              : undefined,
            lastExecutedAt: history.executedAt
              ? new Date(history.executedAt).toISOString()
              : undefined,
            source: "sqlHistory",
          }
        : undefined;

    // Convert canonical binds with saved values when complete, otherwise preserve structure only.
    const driver = await createRDSDriver(connectionSetting, true);
    const toPositionedParameter = driver.isPositionedParameterAvailable();
    const toPositionalCharacter = driver.getPositionalCharacter();
    let nativeSql: string;
    let presetBindValues: unknown[] | undefined;
    if (history.variables && Object.keys(history.variables).length > 0) {
      try {
        const converted = normalizeQuery({
          query: history.sqlDoc,
          bindParams: history.variables,
          toPositionedParameter,
          toPositionalCharacter,
        });
        nativeSql = converted.query;
        presetBindValues = converted.binds;
      } catch {
        nativeSql = normalizeQuery({
          query: history.sqlDoc,
          toPositionedParameter,
          toPositionalCharacter,
        }).query;
        presetBindValues = undefined;
      }
    } else {
      nativeSql = normalizeQuery({
        query: history.sqlDoc,
        toPositionedParameter,
        toPositionalCharacter,
      }).query;
      presetBindValues = undefined;
    }

    // Resolve tables and aliases from vendor-native SQL for plan mapping.
    const targetTables = resolveTargetTables({
      dbType: connectionSetting.dbType,
      sql: nativeSql,
    });
    const tableAliasMap = resolveTableAliasMap({
      dbType: connectionSetting.dbType,
      sql: nativeSql,
    });

    // Resource metadata improves bind type estimates but is optional.
    let databaseResource = stateStorage.getFirstRdsDatabaseByName(history.connectionName);
    if (databaseResource === undefined) {
      const { ok, result } = await stateStorage.loadResource(history.connectionName, false, true);
      databaseResource = ok
        ? (result?.db.find((d) => d instanceof RdsDatabase) as RdsDatabase)
        : undefined;
    }

    // Bind estimation scans vendor-native placeholder syntax.
    const estimatedBindParameters = estimateBindParameters({
      dbType: connectionSetting.dbType,
      sql: nativeSql,
      databaseResource,
    });

    const result = await openPerformanceTuningPreview({
      extensionUri: context.extensionUri,
      connectionSetting,
      initialMaskingLevel: stateStorage.getAiMaskingLevelForConnection(connectionSetting.name),
      databaseName,
      statement: { sql: nativeSql, source: "sqlHistory", statistics },
      targetTables: targetTables.length > 0 ? targetTables : undefined,
      tableAliasMap: Object.keys(tableAliasMap).length > 0 ? tableAliasMap : undefined,
      estimatedBindParameters,
      presetBindValues,
    });

    if (result.status === "failed") {
      showWindowErrorMessage(
        [result.message, result.technicalMessage].filter(Boolean).join(" ") ||
          "Failed to collect performance tuning context."
      );
    }
  });
};
