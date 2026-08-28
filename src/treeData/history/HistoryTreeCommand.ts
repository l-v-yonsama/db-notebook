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
  FOCUS_SQL_HISTORIES_FILTER,
  HISTORY_VIEW_ID,
  NOTEBOOK_TYPE,
  OPEN_DYNAMO_QUERY_PANEL_FROM_HISTORY,
  OPEN_MDH_VIEWER,
  OPEN_SQL_HISTORIES_AS_NOTEBOOK,
  OPEN_SQL_HISTORY,
  REFRESH_SQL_HISTORIES,
  RESET_SQL_HISTORY_PERFORMANCE,
  SORT_SQL_HISTORIES_BY_DURATION,
  SORT_SQL_HISTORIES_BY_RECENT,
  START_PERFORMANCE_TUNING_FROM_HISTORY,
} from "../../constant";

import {
  AwsDriver,
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
  runRuleEngine,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData, resolveCodeLabel } from "@l-v-yonsama/rdh";
import { CellMeta } from "../../types/Notebook";
import { SQLHistory } from "../../types/SQLHistory";
import { MdhViewParams } from "../../types/views";
import { showWindowErrorMessage } from "../../utilities/alertUtil";
import { createRDSDriver, createSQLSupportDriver, workflow } from "../../utilities/driverResolver";
import { existsFileOnWorkspace } from "../../utilities/fsUtil";
import { log } from "../../utilities/logger";
import { readCodeResolverFile, readRuleFile } from "../../utilities/notebookUtil";
import { buildObservationFromHistory } from "../../utilities/dynamoDbHistoryObservation";
import type { DynamoDbPerformanceTuningPreviewRequest } from "../../utilities/dynamoDbPerformanceTuningPreview";
import {
  openDynamoDbPerformanceTuningPreview,
  openPerformanceTuningPreview,
} from "../../utilities/performanceTuningBindConfirmation";
import { averageCapacityUnits, averageElapsedTimeMilli } from "../../utilities/sqlHistoryUtil";
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

  const createNotebookCellsForHistory = (history: SQLHistory): NotebookCellData[] => {
    const cells: NotebookCellData[] = [];
    if (history.variables && Object.keys(history.variables).length > 0) {
      cells.push(
        new NotebookCellData(NotebookCellKind.Code, JSON.stringify(history.variables, null, 2), "json")
      );
    }
    cells.push(createNotebookSqlCellByHistory(history));
    return cells;
  };

  const createNotebookCellsByHistories = (histories: SQLHistory[]): NotebookCellData[] => {
    const cells: NotebookCellData[] = [];
    for (const history of histories) {
      cells.push(createProvenanceMarkdownCellByHistory(history));
      cells.push(...createNotebookCellsForHistory(history));
    }
    return cells;
  };

  const resolveSelectedHistories = (
    history: SQLHistory,
    selectedHistories?: SQLHistory[]
  ): SQLHistory[] =>
    (selectedHistories && selectedHistories.length > 0 ? selectedHistories : [history]).filter(
      (item) => item.request?.kind !== "dynamodbQuery"
    );

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

  registerDisposableCommand(RESET_SQL_HISTORY_PERFORMANCE, async (history: SQLHistory) => {
    const answer = await window.showWarningMessage(
      "Reset the accumulated performance statistics for this SQL History item? The SQL, bind values, and latest result remain available. New executions start a new measurement period.",
      { modal: true },
      "Reset"
    );
    if (answer !== "Reset") {
      return;
    }
    await stateStorage.resetSQLHistoryPerformanceByID(history.id);
    await historyTreeProvider.refresh(true);
    window.showInformationMessage("Performance statistics were reset. Save a baseline report before resetting when you need to retain the previous evidence.");
  });

  registerDisposableCommand(OPEN_SQL_HISTORY, async (history: SQLHistory) => {
    if (history.request?.kind === "dynamodbQuery") {
      return;
    }
    const cells = createNotebookCellsForHistory(history);
    commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
  });

  registerDisposableCommand(
    OPEN_SQL_HISTORIES_AS_NOTEBOOK,
    async (history: SQLHistory, selectedHistories?: SQLHistory[]) => {
      const histories = resolveSelectedHistories(history, selectedHistories);
      if (histories.length === 0) {
        return;
      }
      const cells = createNotebookCellsByHistories(histories);
      commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
    }
  );

  registerDisposableCommand(
    APPEND_SQL_HISTORIES_TO_ACTIVE_NOTEBOOK,
    async (history: SQLHistory, selectedHistories?: SQLHistory[]) => {
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

  // Query-content search reuses VS Code's built-in tree find/filter widget,
  // the same way database-notebook.focus-filter does for the connections
  // view: focus the view, then let "list.find" take over.
  registerDisposableCommand(FOCUS_SQL_HISTORIES_FILTER, async () => {
    await commands.executeCommand(`${HISTORY_VIEW_ID}.focus`);
    await commands.executeCommand("list.find");
  });

  registerDisposableCommand(SORT_SQL_HISTORIES_BY_DURATION, () => {
    historyTreeProvider.setSortOrder("duration");
  });

  registerDisposableCommand(SORT_SQL_HISTORIES_BY_RECENT, () => {
    historyTreeProvider.setSortOrder("recent");
  });

  registerDisposableCommand(OPEN_DYNAMO_QUERY_PANEL_FROM_HISTORY, async (history: SQLHistory) => {
    const request = history.request;
    if (request?.kind !== "dynamodbQuery" || request.origin !== "dynamoQueryPanel") {
      showWindowErrorMessage("This history entry was not created by Dynamo Query Panel.");
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

  // native Query re-execution (design doc §8.2) - never routed through
  // normalizeQuery()/createRDSDriver()/requestSql(): sqlDoc is a value-free
  // description text for this kind, not PartiQL/SQL, and the real, re-
  // executable request already lives in history.request.input.
  const executeDynamoQueryHistory = async (
    connectionSetting: ConnectionSetting,
    history: SQLHistory,
    request: Extract<NonNullable<SQLHistory["request"]>, { kind: "dynamodbQuery" }>
  ): Promise<void> => {
    log(`${PREFIX} native Query:` + JSON.stringify(request.input));

    const { ok, message, result } = await window.withProgress(
      { location: ProgressLocation.Notification, cancellable: false },
      async (progress) => {
        progress.report({ message: `Execute DynamoDB Query: ${request.displayText}`, increment: 50 });
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

      await stateStorage.addSQLHistory({
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

      await stateStorage.addSQLHistory({
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

  registerDisposableCommand(EXECUTE_SQL_HISTORY, async (history: SQLHistory) => {
    const connectionSetting = await stateStorage.getConnectionSettingByName(history.connectionName);
    if (!connectionSetting) {
      showWindowErrorMessage("Missing connection " + history.connectionName);
      await stateStorage.deleteSQLHistoryByID(history.id);
      historyTreeProvider.refresh(true);
      return;
    }

    if (history.request?.kind === "dynamodbQuery") {
      await executeDynamoQueryHistory(connectionSetting, history, history.request);
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

      await stateStorage.addSQLHistory({
        connectionName: history.connectionName,
        sqlDoc: history.sqlDoc,
        variables: history.variables,
        meta: result.meta,
        summary: result.summary,
        ruleFile: history.ruleFile,
        codeResolverFile: history.codeResolverFile,
        executedAt: Date.now(),
        status: "success",
      });
      historyTreeProvider.refresh(true);
    } else {
      showWindowErrorMessage(`Execute query Error: ${message}`);

      await stateStorage.addSQLHistory({
        connectionName: history.connectionName,
        sqlDoc: history.sqlDoc,
        variables: history.variables,
        ruleFile: history.ruleFile,
        codeResolverFile: history.codeResolverFile,
        executedAt: Date.now(),
        status: "error",
        errorMessage: message,
      });
      historyTreeProvider.refresh(true);
    }
  });

  // AWS/DynamoDB branch of START_PERFORMANCE_TUNING_FROM_HISTORY below -
  // design doc §11.3: "AWS branch。databaseName不要、PartiQL bind を`?`に正規
  // 化". Deliberately much shorter than the RDB branch: no databaseName
  // resolution (DynamoDB has no such concept), no estimateBindParameters()/
  // Bind Parameters Panel (Decision 1 of the design review - see
  // openDynamoDbPerformanceTuningPreview()'s own doc comment for why), and no
  // resolveTargetTables()/resolveTableAliasMap()/stateStorage.loadResource()/
  // getFirstRdsDatabaseByName() (all RDB-only concepts; loadResource() in
  // particular internally does a `Scan Limit 1` for attribute-type
  // estimation, which would violate the static Preview's no-item-data-read
  // guarantee - §11.3's own note on the AWS history branch).
  const startDynamoDbPerformanceTuningFromHistory = async (
    connectionSetting: ConnectionSetting,
    history: SQLHistory
  ): Promise<void> => {
    // native Query history (design doc §8.4) carries its own real, value-ful
    // input already - never routed through normalizeQuery() (sqlDoc is a
    // value-free description text for this kind, not PartiQL). Preview's own
    // static collection path (startDynamoDbPerformanceTuningPreview.ts)
    // further strips this down to the values-free
    // DynamoDbQueryAnalysisInput mirror the Context/AI actually receive -
    // ExpressionAttributeValues never reach either from here.
    let request: DynamoDbPerformanceTuningPreviewRequest["statement"]["request"];
    if (history.request?.kind === "dynamodbQuery") {
      request = { kind: "query", input: history.request.input };
    } else {
      // normalizeQuery() converts db-notebook's canonical `:name` bind
      // syntax into DynamoDB PartiQL's `?` positional markers - the same
      // conversion EXECUTE_SQL_HISTORY above needs, and required regardless
      // of whether every marker's value happens to be known: eligibility for
      // Run Observed Read is decided later, driver-side, purely from
      // whether the resulting *text* still contains a `?` (§7.1/§7.4).
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

    // SQL History's rolling Capacity/timing aggregate for this exact
    // statement (sqlHistoryUtil.ts) - the DynamoDB counterpart of the RDB
    // branch's `statistics` below, folded into the collected Context as
    // workload evidence (§6.5) rather than a separate statement-statistics
    // surface (DynamoDB has none to route through - design doc §5.1).
    // lastReturnedItemCount/lastEvaluatedItemCount are sourced from
    // summary.dynamoDb (the DynamoDB API evidence's single source of truth
    // as of the query-panel-history-performance plan §5.4) - selectedRows
    // stays as the fallback for an older history entry saved before
    // summary.dynamoDb existed.
    //
    // readObservationSampleCount..boundedObservationCount (§9.2) are the
    // rolling multi-execution aggregate across repeated runs of this exact
    // structure (performance.dynamoDb, built in StateStorage.addSQLHistory
    // via sqlHistoryUtil's mergeDynamoDbPerformance) - a different, wider-
    // but-shallower degree of evidence than `previousObservation` below
    // (one specific recent execution). weightedFilterPassRate is derived
    // here from the aggregate's own totals (design doc §7.3: "weighted pass
    // rate は保存せず...から算出する"), never averaged from per-sample rates.
    const dynamoDbPerf = history.performance?.dynamoDb;
    const workload: DynamoDbWorkloadContext | undefined = history.performance && history.performance.sampleCount > 0
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
          lastReturnedItemCount: history.summary?.dynamoDb?.returnedItemCount ?? history.summary?.selectedRows,
          lastEvaluatedItemCount: history.summary?.dynamoDb?.evaluatedItemCount,
          source: "sqlHistory",
          lastExecutedAt: history.executedAt ? new Date(history.executedAt).toISOString() : undefined,
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

    // The latest single execution's own read evidence (design doc §9.1) -
    // Observation and Workload are deliberately kept distinct (one recent
    // execution vs. a rolling multi-sample aggregate), never merged into one
    // value.
    const previousObservation = buildObservationFromHistory(history);

    const result = await openDynamoDbPerformanceTuningPreview({
      extensionUri: context.extensionUri,
      connectionSetting,
      statement: { source: "sqlHistory", request, previousObservation },
      workload,
    });

    if (result.status === "failed") {
      showWindowErrorMessage(
        [result.message, result.technicalMessage].filter(Boolean).join(" ") ||
          "Failed to collect DynamoDB performance tuning context."
      );
    }
    // "cancelled" mirrors the RDB branch's own handling below - nothing
    // further to show; "opened" needs no notification either.
  };

  registerDisposableCommand(START_PERFORMANCE_TUNING_FROM_HISTORY, async (history: SQLHistory) => {
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
      showWindowErrorMessage(
        "Could not determine the target database for this SQL history entry."
      );
      return;
    }

    const statistics: SelectedStatementStatistics | undefined = history.performance && history.performance.sampleCount > 0
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

    // 2026-08-19 follow-up #2: history.sqlDoc always uses db-notebook's own
    // canonical, named `:name` bind syntax - never the target vendor's
    // native placeholder syntax - the same reason EXECUTE_SQL_HISTORY above
    // (line ~254) always runs it through normalizeQuery() before actually
    // executing it. Every performance-tuning Provider (e.g.
    // PostgresPerformanceTuningProvider.collectExecutionPlan()) sends
    // statement.sql straight to the database with no normalization of its
    // own, so skipping this step here made any parameterized history entry
    // fail with a vendor syntax error at the ":" (confirmed via debugger:
    // "syntax error at or near \":\"" against a Postgres connection).
    //
    // Prefer converting *with* history.variables as bindParams (one call
    // gives both the converted query text and a real, positionally-aligned
    // binds array to pre-fill the confirm panel with) - this also lets an
    // IN-clause array value expand to the right number of positions in the
    // query text itself, which a bindParams-less conversion below can't know
    // to do. Falls back to a bindParams-less (structural-only) conversion
    // when history.variables is missing/empty, or doesn't cover every
    // marker the SQL actually has (normalizeQuery() throws
    // "Missing bind parameter[s]" in that case) - the confirm panel then
    // opens with its normal blank fields instead of a pre-fill.
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

    // Shared with Query Statistics (9b) - see startPerformanceTuningPreview()'s
    // own doc comment (§10 Phase 5 "Preview接続の共通化と競合防止").
    // targetTables/tableAliasMap (§6.5/§6.6/§7.7 of performance-tuning-
    // query-statistics-parameter-input-plan.ja.md): same MySQL aliased-table
    // EXPLAIN gap Query Statistics has, and history.sqlDoc is just as
    // likely to alias its FROM/JOIN tables as a Query Statistics row's SQL
    // is. Parsed from nativeSql, not history.sqlDoc: a canonical `:name`
    // marker isn't valid Postgres/MySQL syntax, so parsing the already-
    // converted SQL can only help these helpers' AST-based alias resolution,
    // never hurt it.
    const targetTables = resolveTargetTables({
      dbType: connectionSetting.dbType,
      sql: nativeSql,
    });
    const tableAliasMap = resolveTableAliasMap({
      dbType: connectionSetting.dbType,
      sql: nativeSql,
    });

    // 2026-08-19 follow-up: this handler used to call
    // startPerformanceTuningPreview() with no bind values at all, regardless
    // of whether history.sqlDoc had any placeholders - a parameterized
    // history entry could only ever fail to collect a plan. estimateBindParameters()
    // needs the connection's resource tree for column-type estimation (the
    // same reason ToolsViewProvider already requires an RdsDatabase for
    // Query Statistics); load it before building the preview request.
    let databaseResource = stateStorage.getFirstRdsDatabaseByName(history.connectionName);
    if (databaseResource === undefined) {
      const { ok, result } = await stateStorage.loadResource(history.connectionName, false, true);
      databaseResource = ok ? (result?.db.find((d) => d instanceof RdsDatabase) as RdsDatabase) : undefined;
    }

    // estimateBindParameters() scans for the *target vendor's* native
    // marker syntax per dbType ($N for Postgres, :name/:N for Oracle, ...) -
    // not db-notebook's canonical :name convention - so it has to run
    // against nativeSql (already converted above), not history.sqlDoc.
    // Running it against the original canonical text (as this used to)
    // pointed the scanner at the wrong syntax entirely: for any non-
    // Oracle/SQL Server vendor it silently found no markers at all, which -
    // combined with the syntax-error bug above - meant the confirm panel
    // never even opened for a Postgres example that clearly had a
    // `:channel` marker (confirmed via debugger: estimatedBindParameters
    // came back `[]`). No `databaseResource ?` guard here either (unlike
    // before): estimateBindParameters() already degrades gracefully with no
    // column hints when it's undefined - skipping the scan entirely in that
    // case used to silently skip the confirm panel too whenever the
    // resource tree couldn't be loaded.
    const estimatedBindParameters = estimateBindParameters({
      dbType: connectionSetting.dbType,
      sql: nativeSql,
      databaseResource,
    });

    const result = await openPerformanceTuningPreview({
      extensionUri: context.extensionUri,
      connectionSetting,
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
    // "cancelled" mirrors standard VS Code progress-cancellation UX (the
    // user asked to stop, so no further notification is shown); "deferred"
    // means PerformanceTuningBindParametersPanel opened instead and now owns
    // the rest of this flow - also nothing further to show here.
  });
};
