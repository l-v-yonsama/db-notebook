import {
  DBType,
  estimateBindParameters,
  EstimatedBindParameter,
  RdsDatabase,
} from "@l-v-yonsama/multi-platform-database-drivers";

// See misc/design/performance-tuning-query-statistics-parameter-input-plan.ja.md
// §7.2 for the full rationale. `sql`/`normalizedSql` are always the row's
// existing `query` column (every Vendor already returns it); `representative*`
// is currently MySQL-only (QUERY_SAMPLE_TEXT and friends) and undefined for
// every other Vendor, which selectPlanSql() below treats the same as "not
// usable" and falls straight through to normalizedSql.
export type QueryStatisticsPlanInput = {
  sql: string;
  normalizedSql?: string;
  representativeSql?: string;
  representativeSqlSeenAt?: string;
  representativeSqlSource?: string;
  representativeSqlMayBeTruncated?: boolean;
};

export type SelectedPlanSql = {
  sql: string;
  estimatedBindParameters: EstimatedBindParameter[];
};

// Picks which SQL to run estimateBindParameters() against and to eventually
// send as `statement.sql`, and returns its estimate alongside it as one
// unit so a caller can never show bind rows for a different SQL than the
// one it will actually preview (§7.2 rule 6: "最終的に選んだSQLの推定結果
// をestimatedBindParametersとして一緒に返す").
//
// Selection order (§7.2):
// 1. A non-empty, not-suspected-truncated representativeSql is preferred -
//    it's more likely to carry real literals than the always-normalized
//    fallback.
// 2. If that SQL turns out to have no placeholders, it's used as-is (a
//    complete, literal SQL - no Bind Parameters UI needed).
// 3. If placeholders remain in it (a prepared-statement sample), it's
//    prepared-statement-shaped rather than representative, so this falls
//    through to normalizedSql instead.
// 4. representativeSql missing/blank/truncated-suspect also falls through
//    to normalizedSql.
// 5. normalizedSql missing falls through to `sql` (always present).
export function selectPlanSql(params: {
  input: QueryStatisticsPlanInput;
  dbType: DBType;
  databaseResource: RdsDatabase;
}): SelectedPlanSql {
  const { input, dbType, databaseResource } = params;

  const representativeSql = input.representativeSql;
  const representativeSqlUsable =
    typeof representativeSql === "string" &&
    representativeSql.trim() !== "" &&
    input.representativeSqlMayBeTruncated !== true;

  if (representativeSqlUsable) {
    const estimated = estimateBindParameters({ dbType, sql: representativeSql!, databaseResource });
    if (estimated.length === 0) {
      return { sql: representativeSql!, estimatedBindParameters: [] };
    }
    // Placeholders remain - this sample is prepared-statement-shaped, not a
    // usable literal representative. Fall through to normalizedSql below.
  }

  const fallbackSql = input.normalizedSql ?? input.sql;
  return {
    sql: fallbackSql,
    estimatedBindParameters: estimateBindParameters({ dbType, sql: fallbackSql, databaseResource }),
  };
}
