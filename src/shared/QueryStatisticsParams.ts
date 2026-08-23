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

// Fully normalized Query Statistics search conditions. Initial callers may
// be partial, but the view/provider always use this complete shape.
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
};
