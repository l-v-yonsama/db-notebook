import {
  ConnectionSetting,
  DbResource,
  EstimatedBindParameter,
  RDSBaseDriver,
  RdsDatabase,
  normalizeStatementStatisticsParams,
  resolveTableAliasMap,
  resolveTargetTables,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import * as path from "path";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { BOTTOM_TOOLS_VIEWID } from "../constant";
import {
  ActionCommand,
  OutputParams,
  PreviewPerformanceTuningActionCommand,
  SearchQueryStatisticsActionCommand,
} from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { ToolsViewEventData } from "../shared/MessageEventData";
import {
  QueryStatisticsPreviewStatus,
  QueryStatisticsSearchParams,
  QueryStatisticsSearchStatus,
} from "../shared/QueryStatisticsParams";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { workflow } from "../utilities/driverResolver";
import { createBookFromList } from "../utilities/excel";
import { createHtmlFromRdhList } from "../utilities/html/htmlGenerator";
import { openPerformanceTuningPreview } from "../performanceTuning/preview/performanceTuningBindConfirmation";
import { selectPlanSql } from "./queryStatistics/queryStatisticsPlanSql";
import {
  MappedStatementStatisticsRow,
  mapStatementStatisticsRow,
} from "./queryStatistics/queryStatisticsRowMapper";
import { StateStorage } from "../utilities/StateStorage";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";

const PREFIX = "[ToolsView]";
dayjs.extend(utc);

type ToolsViewMode = "sessions" | "locks" | "queryStatistics";

// A discriminated union keeps Query Statistics data separate from sessions
// and locks, whose resource type is broader.
export type ToolsViewParams =
  | { viewMode: "sessions" | "locks"; conName: string; res: DbResource }
  | {
      viewMode: "queryStatistics";
      conName: string;
      res: RdsDatabase;
      search?: Partial<QueryStatisticsSearchParams>;
    };

// Resolved once per render()/query and never re-derived from the RDH result
// - res.name is the only source of truth for the queried database.
type QueryStatisticsDatabaseInfo = {
  connectionName: string;
  databaseName: string;
  vendor: string;
};

const DEFAULT_QUERY_STATISTICS_SEARCH: QueryStatisticsSearchParams = normalizeStatementStatisticsParams(
  { databaseName: "" }
);

export class ToolsViewProvider extends BaseViewProvider {
  private rdh: ResultSetData | undefined = undefined;
  private res: DbResource | undefined = undefined;
  private viewMode: ToolsViewMode = "sessions";
  private settings: ConnectionSetting | undefined;

  // --- Query Statistics mode only (§10 Phase 5) ---
  private queryStatisticsDatabase: QueryStatisticsDatabaseInfo | undefined;
  private search: QueryStatisticsSearchParams = DEFAULT_QUERY_STATISTICS_SEARCH;
  private searchStatus: QueryStatisticsSearchStatus = "loading";
  private searchMessage: string | undefined;
  private previewStatus: QueryStatisticsPreviewStatus = "idle";
  private previewMessage: string | undefined;
  private previewTechnicalMessage: string | undefined;
  // Bumped every time `rdh` is replaced (including back to `undefined`) so a
  // row-selection round trip from the webview (resultVersion + rowIndex) can
  // be rejected once it no longer matches what the webview was shown
  // (§10 Phase 5 "行選択とworkload変換").
  private resultVersion = 0;
  // Bumped on every search start, mode switch, and close so a slow, stale
  // search response can never overwrite a newer one or a since-cleared view
  // (§10 Phase 5 "検索ライフサイクル").
  private requestGeneration = 0;

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "ToolsView";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "kill":
        // The Kill button is not rendered in Query Statistics mode, but
        // guard here too rather than trusting the webview alone.
        if (this.viewMode !== "queryStatistics") {
          this.kill(params.sessionOrPid);
        }
        break;
      case "cancel":
        {
          this.webviewView = undefined;
          this.clear();

          await commands.executeCommand("setContext", BOTTOM_TOOLS_VIEWID + ".visible", false);
        }
        break;
      case "refresh":
        await this.searchAndRefresh();
        break;
      case "output":
        this.output(params);
        break;
      case "searchQueryStatistics":
        await this.updateQueryStatisticsSearch(params);
        break;
      case "previewPerformanceTuning":
        await this.previewPerformanceTuning(params);
        break;
    }
  }

  async render(params: ToolsViewParams) {
    this.clear();
    const { viewMode, conName, res } = params;
    this.viewMode = viewMode;
    this.res = res;

    const setting = await this.stateStorage.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }
    this.settings = setting;

    if (viewMode === "queryStatistics") {
      this.queryStatisticsDatabase = {
        connectionName: conName,
        databaseName: res.name,
        vendor: setting.dbType,
      };
      // Reuses the driver's own default/clamp rules (§10 Phase 5 "UIとDriver
      // に別々のmagic numberを持たせない") rather than redeclaring
      // DEFAULT_STATEMENT_STATISTICS_LIMIT / StatementStatisticsSortKey.TotalElapsedTime here.
      this.search = normalizeStatementStatisticsParams({
        databaseName: res.name,
        ...params.search,
      });
    }

    await this.search_();

    if (this.webviewView === undefined) {
      await commands.executeCommand("setContext", BOTTOM_TOOLS_VIEWID + ".visible", true);
    }

    await commands.executeCommand(BOTTOM_TOOLS_VIEWID + ".focus", {
      preserveFocus: true,
    });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.renderSub();
  }

  protected onDidChangeVisibility(visible: boolean): void {
    if (visible !== true) {
      return;
    }
    if (this.viewMode === "queryStatistics") {
      this.postQueryStatisticsState();
      return;
    }
    this.postMessage<ToolsViewEventData>({
      command: "refresh",
      componentName: "ToolsView",

      value: {
        refresh: {
          mode: this.viewMode,
          rdh: this.rdh,
        },
      },
    });
  }

  private async renderSub() {
    this.onDidChangeVisibility(true);
  }

  private async searchAndRefresh() {
    await this.search_();
    await this.renderSub();
  }

  // Named search_() (not search()) only to avoid colliding with the private
  // `search` field that holds the current Query Statistics search
  // conditions.
  private async search_() {
    const { viewMode, res, settings } = this;
    if (settings === undefined) {
      return;
    }

    if (viewMode === "locks" || viewMode === "sessions") {
      if (res === undefined) {
        return;
      }
      const { ok, message, result } = await workflow<
        RDSBaseDriver,
        ResultSetData
      >(settings, async (driver) => {
        if (viewMode === "sessions") {
          return await driver.getSessions(res.name);
        } else {
          return await driver.getLocks(res.name);
        }
      }, true);
      if (ok && result) {
        this.rdh = result;
      } else {
        showWindowErrorMessage(message);
        return;
      }
    } else if (viewMode === "queryStatistics") {
      await this.searchQueryStatistics();
    }
  }

  // Distinguishes "as designed, nothing to show" (unavailable/empty) from a
  // genuine failure (error) rather than collapsing every non-happy path
  // into one error toast (§10 Phase 5 "検索ライフサイクル"). Static support
  // and per-connection availability are both checked, in the same
  // workflow() connection lifecycle as the search itself, per §10 Phase 5's
  // note that this duplicates the lightweight probe some Vendor drivers
  // already run internally - an acceptable, explicitly-scoped-out tradeoff
  // rather than a reason to change 4 Vendor drivers' public API here.
  private async searchQueryStatistics() {
    const { settings, queryStatisticsDatabase, search } = this;
    if (settings === undefined || queryStatisticsDatabase === undefined) {
      return;
    }

    const myGeneration = ++this.requestGeneration;
    this.setRdh(undefined);
    this.searchStatus = "loading";
    this.searchMessage = undefined;
    this.previewStatus = "idle";
    this.previewMessage = undefined;
    this.previewTechnicalMessage = undefined;
    this.postQueryStatisticsState();

    type Outcome =
      | { kind: "unavailable"; message: string }
      | { kind: "result"; rdh: ResultSetData };

    const { ok, message, result } = await workflow<RDSBaseDriver, Outcome>(
      settings,
      async (driver) => {
        if (!driver.supportsGetStatementStatistics()) {
          return {
            kind: "unavailable",
            message: `Query statistics are not supported for ${settings.dbType}.`,
          };
        }
        const availability = await driver.checkStatementStatisticsAvailability(
          queryStatisticsDatabase.databaseName
        );
        if (!availability.ok) {
          return {
            kind: "unavailable",
            message: availability.message || "Query statistics are unavailable for this connection.",
          };
        }
        const rdh = await driver.getStatementStatistics({
          databaseName: queryStatisticsDatabase.databaseName,
          sortBy: search.sortBy,
          limit: search.limit,
          minimumAverageElapsedTimeMs: search.minimumAverageElapsedTimeMs,
        });
        return { kind: "result", rdh };
      },
      true
    );

    if (myGeneration !== this.requestGeneration) {
      // A newer search/mode-switch/close superseded this one - never let a
      // slow response overwrite what's currently displayed.
      return;
    }

    if (!ok) {
      this.searchStatus = "error";
      this.searchMessage = message || "Failed to load query statistics.";
    } else if (result?.kind === "unavailable") {
      this.searchStatus = "unavailable";
      this.searchMessage = result.message;
    } else if (result?.kind === "result") {
      this.setRdh(result.rdh);
      this.searchStatus = result.rdh.rows.length === 0 ? "empty" : "ready";
      this.searchMessage = undefined;
    }

    this.postQueryStatisticsState();
  }

  private async updateQueryStatisticsSearch(
    partial: SearchQueryStatisticsActionCommand["params"]
  ) {
    if (this.viewMode !== "queryStatistics" || this.queryStatisticsDatabase === undefined) {
      return;
    }
    this.search = normalizeStatementStatisticsParams({
      databaseName: this.queryStatisticsDatabase.databaseName,
      ...partial,
    });
    await this.searchAndRefresh();
  }

  // Resolves a Query Statistics row into the request needed to open a preview.
  private resolveQueryStatisticsPlanForRow(
    rowIndex: number
  ):
    | {
        sql: string;
        estimatedBindParameters: EstimatedBindParameter[];
        targetTables: Array<{ schemaName?: string; tableName: string }>;
        tableAliasMap: Record<string, { schemaName?: string; tableName: string }>;
        statistics: MappedStatementStatisticsRow["statistics"];
      }
    | undefined {
    if (this.rdh === undefined || this.settings === undefined || !(this.res instanceof RdsDatabase)) {
      return undefined;
    }
    const row = this.rdh.rows[rowIndex];
    if (row === undefined) {
      return undefined;
    }
    const mapped = mapStatementStatisticsRow(row.values);
    if (!mapped) {
      return undefined;
    }
    const { sql, estimatedBindParameters } = selectPlanSql({
      input: mapped.planInput,
      dbType: this.settings.dbType,
      databaseResource: this.res,
    });
    const targetTables = resolveTargetTables({ dbType: this.settings.dbType, sql });
    const tableAliasMap = resolveTableAliasMap({ dbType: this.settings.dbType, sql });
    return { sql, estimatedBindParameters, targetTables, tableAliasMap, statistics: mapped.statistics };
  }

  // The bind-value panel owns its deferred collection state.
  private async previewPerformanceTuning(
    params: PreviewPerformanceTuningActionCommand["params"]
  ) {
    if (this.viewMode !== "queryStatistics" || this.queryStatisticsDatabase === undefined) {
      return;
    }
    // Multiple in-flight collections are prevented in the UI (the row
    // button and Refresh are disabled while collecting), but guard here too.
    if (this.previewStatus === "collecting") {
      return;
    }
    if (params.resultVersion !== this.resultVersion || this.rdh === undefined) {
      // A stale selection against a result the user has since replaced -
      // never resolve a row index against the wrong list.
      return;
    }
    const resolved = this.resolveQueryStatisticsPlanForRow(params.rowIndex);
    if (!resolved) {
      this.previewStatus = "error";
      this.previewMessage = "Could not determine the SQL text for the selected row.";
      this.previewTechnicalMessage = undefined;
      this.postQueryStatisticsState();
      return;
    }

    const { settings, queryStatisticsDatabase } = this;
    if (settings === undefined) {
      return;
    }

    const myResultVersion = this.resultVersion;
    this.previewStatus = "collecting";
    this.previewMessage = undefined;
    this.previewTechnicalMessage = undefined;
    this.postQueryStatisticsState();

    const result = await openPerformanceTuningPreview({
      extensionUri: this.context.extensionUri,
      connectionSetting: settings,
      initialMaskingLevel: this.stateStorage.getAiMaskingLevelForConnection(settings.name),
      databaseName: queryStatisticsDatabase.databaseName,
      statement: {
        sql: resolved.sql,
        source: "statementStatistics",
        statistics: resolved.statistics,
      },
      // MySQL's aliased-table EXPLAIN gap (§6.5/§6.6/§7.7): tableAliasMap
      // corrects a plan-resolved alias (e.g. `o`) to its real table name
      // before it's used for anything; targetTables additively adds a
      // table the plan didn't resolve at all. Complementary, not
      // redundant - see RDSBaseDriver.getPerformanceTuningContext()'s own
      // comment on why both are kept.
      targetTables: resolved.targetTables.length > 0 ? resolved.targetTables : undefined,
      tableAliasMap:
        Object.keys(resolved.tableAliasMap).length > 0 ? resolved.tableAliasMap : undefined,
      estimatedBindParameters: resolved.estimatedBindParameters,
    });

    if (this.viewMode !== "queryStatistics" || this.resultVersion !== myResultVersion) {
      // The view moved on (closed, mode switched, or a new search replaced
      // the list) while this collection was in flight - drop it silently.
      return;
    }

    if (result.status === "opened" || result.status === "deferred") {
      this.previewStatus = "idle";
      this.previewMessage = undefined;
      this.previewTechnicalMessage = undefined;
    } else if (result.status === "cancelled") {
      this.previewStatus = "cancelled";
      this.previewMessage = undefined;
      this.previewTechnicalMessage = undefined;
    } else {
      this.previewStatus = "error";
      this.previewMessage = result.message;
      this.previewTechnicalMessage = result.technicalMessage;
    }
    this.postQueryStatisticsState();
  }

  private postQueryStatisticsState() {
    if (this.viewMode !== "queryStatistics" || this.queryStatisticsDatabase === undefined) {
      return;
    }
    this.postMessage<ToolsViewEventData>({
      command: "refresh",
      componentName: "ToolsView",
      value: {
        refresh: {
          mode: "queryStatistics",
          searchStatus: this.searchStatus,
          message: this.searchMessage,
          previewStatus: this.previewStatus,
          previewMessage: this.previewMessage,
          previewTechnicalMessage: this.previewTechnicalMessage,
          resultVersion: this.resultVersion,
          search: this.search,
          database: this.queryStatisticsDatabase,
          rdh: this.rdh,
        },
      },
    });
  }

  private setRdh(rdh: ResultSetData | undefined) {
    this.rdh = rdh;
    this.resultVersion++;
  }

  private async output(data: OutputParams) {
    if (!this.rdh) {
      return;
    }
    const fileExtension = data.fileType === "excel" ? "xlsx" : "html";
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${this.viewMode}.${fileExtension}`;
    const previousFolder = await this.stateStorage.getPreviousSaveFolder();
    const baseUri = previousFolder ? Uri.file(previousFolder) : Uri.file("./");
    const uri = await window.showSaveDialog({
      defaultUri: Uri.joinPath(baseUri, defaultFileName),
      filters: { "*": [fileExtension] },
    });
    if (!uri) {
      return;
    }
    await this.stateStorage.setPreviousSaveFolder(path.dirname(uri.fsPath));
    const message =
      data.fileType === "excel"
        ? await createBookFromList([this.rdh], uri.fsPath, {
            rdh: {
              outputAllOnOneSheet: true,
            },
          })
        : await createHtmlFromRdhList([this.rdh], uri.fsPath);
    if (message) {
      showWindowErrorMessage(message);
    } else {
      window.setStatusBarMessage(uri.fsPath, 3000);
    }
  }

  private async kill(sessionOrPid: number | undefined) {
    const { viewMode, res, settings } = this;
    if (settings === undefined) {
      return;
    }
    if (sessionOrPid === undefined || isNaN(sessionOrPid)) {
      return;
    }
    const answer = await window.showInformationMessage(
      `Are you sure to terminate(kill) session:${sessionOrPid}?`,
      "YES",
      "NO"
    );
    if (answer !== "YES") {
      return;
    }
    const { ok, message, result } = await workflow<
      RDSBaseDriver,
      string
    >(settings, async (driver) => {
      return await driver.kill(sessionOrPid);
    }, true);
    if (ok) {
      if (result) {
        showWindowErrorMessage(result);
        return;
      } else {
        window.showInformationMessage("OK");
        await this.searchAndRefresh();
      }
    } else {
      showWindowErrorMessage(message);
      return;
    }
  }

  private clear() {
    this.viewMode = "sessions";
    this.rdh = undefined;
    this.res = undefined;
    this.settings = undefined;
    this.queryStatisticsDatabase = undefined;
    this.search = DEFAULT_QUERY_STATISTICS_SEARCH;
    this.searchStatus = "loading";
    this.searchMessage = undefined;
    this.previewStatus = "idle";
    this.previewMessage = undefined;
    this.previewTechnicalMessage = undefined;
    this.resultVersion = 0;
    this.requestGeneration++;
  }
}
