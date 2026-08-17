// Mirrors @l-v-yonsama/multi-platform-database-drivers' StatementStatisticsSortKey
// runtime values (not re-exported as a `type`-only import, on purpose - see
// DBType.ts/ConnectionEnvironment.ts in this same directory for the
// established reason: a *value* import from that package's root barrel
// drags its entire dependency tree (AWS SDK, mysql2, oracledb, tedious, ...)
// into the webview bundle, which is both a large size regression and, at
// least at the time this was added, an outright Vite build failure from an
// AWS SDK submodule that isn't browser-buildable). Keep in sync with
// db-drivers' src/types/drivers/StatementStatistics.ts by hand - it's 4
// stable string literals, not worth a build-time sync step.
export const StatementStatisticsSortKey = {
  TotalElapsedTime: "totalElapsedTime",
  AverageElapsedTime: "averageElapsedTime",
  MaxElapsedTime: "maxElapsedTime",
  ExecutionCount: "executionCount",
} as const;

export type StatementStatisticsSortKey =
  (typeof StatementStatisticsSortKey)[keyof typeof StatementStatisticsSortKey];
