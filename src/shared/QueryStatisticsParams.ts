import type {
  EstimatedBindParameter,
  EstimatedBindParameterLocation,
  StatementStatisticsSortKey,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { ResultSetData } from "@l-v-yonsama/rdh";

// One Bind Parameters input row (misc/design/performance-tuning-query-
// statistics-parameter-input-plan.ja.md §5.2). Adds Vue row-key `id` and the
// user's own input `value` on top of db-drivers' estimate; `location` is
// widened to optional because a row the user added via "Add parameter" has
// no real position in the SQL text to report (§7.3's Add helper).
export type BindParameterRow = Omit<EstimatedBindParameter, "location"> & {
  id: string;
  value: string;
  location?: EstimatedBindParameterLocation;
};

// Search conditions for the Query Statistics Tools View mode (§10 Phase 5 of
// misc/design/performance-tuning-context-implementation-plan.ja.md). A
// deliberately narrow, fully-normalized shape (no optional fields) - the
// panel/provider always work with a complete set of conditions; only the
// *initial* params coming in from a resource tree command may be partial
// (see ToolsViewParams.search below).
export type QueryStatisticsSearchParams = {
  sortBy: StatementStatisticsSortKey;
  limit: number;
  minimumAverageElapsedTimeMs: number;
};

// Mirrors RDSBaseDriver.getStatementStatistics()'s two-phase capability
// check (§1: "静的な対応可否と、現在の接続での動的な利用可否は...二段階に
// する") - `searchStatus` distinguishes "as designed, nothing to show here"
// (unavailable/empty) from a genuine failure (error), rather than collapsing
// every non-happy-path into one error toast (§10 Phase 5).
export type QueryStatisticsSearchStatus = "loading" | "ready" | "empty" | "unavailable" | "error";

// Independent from searchStatus: a search result stays on screen while a
// context collection is in flight/fails/is cancelled for a selected row, so
// the RDH list itself never has to be re-fetched just because a preview
// attempt didn't work out (§10 Phase 5 "検索結果を保持したままPreviewの収
// 集状態を表示できるよう、searchStatusとpreviewStatusは分離する").
export type QueryStatisticsPreviewStatus = "idle" | "collecting" | "cancelled" | "error";

// The full state the webview needs to render Query Statistics mode - posted
// as one unit (mode.refresh's queryStatistics branch) so a state update
// never leaves the webview holding half-old, half-new fields.
export type QueryStatisticsViewState = {
  searchStatus: QueryStatisticsSearchStatus;
  message?: string;
  previewStatus: QueryStatisticsPreviewStatus;
  previewMessage?: string;
  previewTechnicalMessage?: string;
  // Bumped by ToolsViewProvider every time `rdh` changes (a fresh search
  // result). The webview must echo this back unchanged when starting a
  // preview (ActionParams.PreviewPerformanceTuningActionCommand) so the
  // provider can detect - and refuse - a stale row selection against a list
  // that has since been replaced (§10 Phase 5 "行選択とworkload変換").
  resultVersion: number;
  search: QueryStatisticsSearchParams;
  database: { connectionName: string; databaseName: string; vendor: string };
  rdh?: ResultSetData;
  // Set once a row has been selected (ToolsViewProvider re-resolves it from
  // resultVersion + rowIndex, never trusts a webview-supplied SQL/estimate -
  // §7.1). `selectedRowIndex` is how the webview tells "a new row was
  // selected" (and must re-init its Bind Parameters rows) apart from "the
  // same row, only previewStatus changed" (§7.5). An empty
  // `estimatedBindParameters` array (as opposed to it being absent) means
  // the selected row's SQL has no placeholders - the Bind Parameters
  // fieldset stays hidden entirely (§4: "SQLにplaceholderが無い場合、
  // fieldset自体を表示しない").
  selectedRowIndex?: number;
  estimatedBindParameters?: EstimatedBindParameter[];
};
