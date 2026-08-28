import type { RdhDynamoDbSummary } from "@l-v-yonsama/rdh";
import type { SQLHistory, SQLHistoryDynamoDbPerformance, SQLHistoryPerformance } from "../types/SQLHistory";
import type { SQLMode } from "../types/Notebook";

export type StoredSQLHistory = SQLHistory & {
  // M1の開発途中で保存された値。移行後のSQLHistoryには保持しない。
  sqlMode?: SQLMode;
};

type SQLHistoryTarget = Pick<SQLHistory, "sqlDoc" | "meta"> & {
  sqlMode?: SQLMode;
};

const EMPTY_PERFORMANCE: SQLHistoryPerformance = {
  sampleCount: 0,
  totalElapsedTimeMilli: 0,
};

export const resetSQLHistoryPerformance = (
  resetAt = Date.now(),
  includeDynamoDbAggregate = false
): SQLHistoryPerformance => ({
  ...EMPTY_PERFORMANCE,
  ...(includeDynamoDbAggregate
    ? {
        capacitySampleCount: 0,
        dynamoDb: {
          observationSampleCount: 0,
          evaluatedCountSampleCount: 0,
          totalReturnedItemCount: 0,
          totalEvaluatedItemCount: 0,
          boundedObservationCount: 0,
        },
      }
    : {}),
  statisticsSince: resetAt,
  resetAt,
});

// Older entries were created before `performance` existed. Derive an
// equivalent starting point from the single `summary.elapsedTimeMilli`
// value they already carried, so existing history isn't discarded.
export const migrateLegacyPerformance = (previous: SQLHistory): SQLHistoryPerformance => {
  if (previous.performance) {
    return previous.performance;
  }
  if (previous.status === "error") {
    return { ...EMPTY_PERFORMANCE };
  }
  const legacyElapsed = previous.summary?.elapsedTimeMilli;
  const legacyCapacity = previous.summary?.capacityUnits;
  if (legacyElapsed === undefined) {
    return { ...EMPTY_PERFORMANCE };
  }
  return {
    sampleCount: 1,
    totalElapsedTimeMilli: legacyElapsed,
    maxElapsedTimeMilli: legacyElapsed,
    lastElapsedTimeMilli: legacyElapsed,
    ...(legacyCapacity !== undefined
      ? { capacitySampleCount: 1, totalCapacityUnits: legacyCapacity, maxCapacityUnits: legacyCapacity, lastCapacityUnits: legacyCapacity }
      : {}),
  };
};

const isPlanMeta = (history: SQLHistoryTarget): boolean => {
  const type = history.meta?.type?.toLocaleLowerCase();
  return type === "explain" || type === "analyze";
};

// SQL文字列を正規表現だけで判定せず、コメント・引用符・PostgreSQLの
// dollar quoteを読み飛ばしながら、各statementの先頭keywordを調べる。
export const containsExplainStatement = (sql: string): boolean => {
  let index = 0;
  let isStatementStart = true;
  let quote: "'" | '"' | "`" | "]" | undefined;
  let dollarQuote: string | undefined;
  let blockCommentDepth = 0;
  let lineComment = false;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (current === "\n" || current === "\r") {
        lineComment = false;
      }
      index += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length;
        dollarQuote = undefined;
      } else {
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (current === quote) {
        if (quote !== "]" && next === quote) {
          index += 2;
          continue;
        }
        quote = undefined;
      } else if (current === "\\" && quote !== "]") {
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (current === "-" && next === "-") {
      lineComment = true;
      index += 2;
      continue;
    }
    if (current === "#") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      quote = current;
      isStatementStart = false;
      index += 1;
      continue;
    }
    if (current === "[") {
      quote = "]";
      isStatementStart = false;
      index += 1;
      continue;
    }
    if (current === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarQuote = tag;
        isStatementStart = false;
        index += tag.length;
        continue;
      }
    }
    if (current === ";") {
      isStatementStart = true;
      index += 1;
      continue;
    }
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (isStatementStart && /[A-Za-z_]/.test(current)) {
      const keyword = sql.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0];
      if (keyword?.toLocaleUpperCase() === "EXPLAIN") {
        return true;
      }
      isStatementStart = false;
      index += keyword?.length ?? 1;
      continue;
    }

    isStatementStart = false;
    index += 1;
  }

  return false;
};

export const isSQLHistoryTarget = (history: SQLHistoryTarget): boolean => {
  if (history.sqlMode !== undefined && history.sqlMode !== "Query") {
    return false;
  }
  return !isPlanMeta(history) && !containsExplainStatement(history.sqlDoc);
};

export const migrateStoredSQLHistory = (stored: StoredSQLHistory): SQLHistory | undefined => {
  if (!isSQLHistoryTarget(stored)) {
    return undefined;
  }

  const { sqlMode: _legacySqlMode, ...history } = stored;
  return {
    ...history,
    // Native Query history existed briefly before producer provenance was
    // persisted. During this unreleased development period DynamoQueryPanel
    // was its only producer, so those entries can be upgraded unambiguously.
    request:
      history.request?.kind === "dynamodbQuery"
        ? { ...history.request, origin: history.request.origin ?? "dynamoQueryPanel" }
        : history.request,
    performance: migrateLegacyPerformance(history),
  };
};

// Folds a new execution's Capacity reading into the base aggregates. A run
// with no measurable capacityUnits (any non-AWS vendor, or an AWS run whose
// summary didn't carry one) leaves these fields exactly as they were -
// mirrors mergeSQLHistoryPerformance's own elapsedTimeMilli rule.
const mergeCapacity = (
  base: SQLHistoryPerformance,
  capacityUnits: number | undefined
): Partial<Pick<SQLHistoryPerformance, "capacitySampleCount" | "totalCapacityUnits" | "maxCapacityUnits" | "lastCapacityUnits">> => {
  if (capacityUnits === undefined) {
    return base.capacitySampleCount === undefined
      ? {}
      : {
          capacitySampleCount: base.capacitySampleCount,
          totalCapacityUnits: base.totalCapacityUnits,
          maxCapacityUnits: base.maxCapacityUnits,
          lastCapacityUnits: base.lastCapacityUnits,
        };
  }
  return {
    capacitySampleCount: (base.capacitySampleCount ?? 0) + 1,
    totalCapacityUnits: (base.totalCapacityUnits ?? 0) + capacityUnits,
    maxCapacityUnits: Math.max(base.maxCapacityUnits ?? 0, capacityUnits),
    lastCapacityUnits: capacityUnits,
  };
};

// Undefined never overrides a defined min/max - only two defined values are
// ever compared. Mirrors mergeCapacity's "leave untouched unless reported"
// rule, applied to a min/max pair instead of a running total.
function minOptional(base: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) {
    return base;
  }
  return base === undefined ? next : Math.min(base, next);
}
function maxOptional(base: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) {
    return base;
  }
  return base === undefined ? next : Math.max(base, next);
}

// Folds one execution's DynamoDB read-shape evidence into the rolling
// aggregate (design doc §7.3). `dynamoDb` undefined (any non-AWS history, or
// a failed retry with no summary at all) leaves `base` completely untouched -
// mirrors mergeCapacity/the elapsed-time rule above. evaluatedItemCount is
// only ever defined for a native Query/Scan sample (never PartiQL) - see
// RdhDynamoDbSummary's own doc comment - so evaluatedCountSampleCount can be
// smaller than observationSampleCount for a mixed-mode history.
function mergeDynamoDbPerformance(
  base: SQLHistoryDynamoDbPerformance | undefined,
  dynamoDb: RdhDynamoDbSummary | undefined
): SQLHistoryDynamoDbPerformance | undefined {
  if (!dynamoDb) {
    return base;
  }
  const { returnedItemCount, evaluatedItemCount } = dynamoDb;
  const filterPassRate =
    evaluatedItemCount !== undefined && evaluatedItemCount > 0 && returnedItemCount !== undefined
      ? returnedItemCount / evaluatedItemCount
      : undefined;

  return {
    observationSampleCount: (base?.observationSampleCount ?? 0) + 1,
    evaluatedCountSampleCount: (base?.evaluatedCountSampleCount ?? 0) + (evaluatedItemCount !== undefined ? 1 : 0),
    totalReturnedItemCount: (base?.totalReturnedItemCount ?? 0) + (returnedItemCount ?? 0),
    totalEvaluatedItemCount: (base?.totalEvaluatedItemCount ?? 0) + (evaluatedItemCount ?? 0),
    // Always this execution's own value (even undefined) - never a stale
    // carry-over from an earlier sample.
    lastReturnedItemCount: returnedItemCount,
    lastEvaluatedItemCount: evaluatedItemCount,
    minFilterPassRate: minOptional(base?.minFilterPassRate, filterPassRate),
    maxFilterPassRate: maxOptional(base?.maxFilterPassRate, filterPassRate),
    lastFilterPassRate: filterPassRate,
    boundedObservationCount: (base?.boundedObservationCount ?? 0) + (dynamoDb.continuationTokenPresent === true ? 1 : 0),
  };
}

// Folds a new execution's elapsed time (and, additively, Capacity/DynamoDB
// read-shape evidence) into the previous entry's stats. Runs without a
// measurable duration (e.g. errors) leave the elapsed-time aggregates
// untouched, so failed re-runs don't skew avg/max; the Capacity and
// DynamoDB aggregates follow the same rule independently via
// mergeCapacity()/mergeDynamoDbPerformance().
export const mergeSQLHistoryPerformance = (
  previous: SQLHistory,
  elapsedTimeMilli: number | undefined,
  capacityUnits?: number,
  dynamoDb?: RdhDynamoDbSummary
): SQLHistoryPerformance => {
  const base = migrateLegacyPerformance(previous);
  const capacity = mergeCapacity(base, capacityUnits);
  const dynamoDbPerformance = mergeDynamoDbPerformance(base.dynamoDb, dynamoDb);
  const merged =
    elapsedTimeMilli === undefined
      ? { ...base, ...capacity }
      : {
          sampleCount: base.sampleCount + 1,
          totalElapsedTimeMilli: base.totalElapsedTimeMilli + elapsedTimeMilli,
          maxElapsedTimeMilli: Math.max(base.maxElapsedTimeMilli ?? elapsedTimeMilli, elapsedTimeMilli),
          lastElapsedTimeMilli: elapsedTimeMilli,
          statisticsSince: base.statisticsSince,
          resetAt: base.resetAt,
          ...capacity,
        };
  return dynamoDbPerformance ? { ...merged, dynamoDb: dynamoDbPerformance } : merged;
};

export const createInitialSQLHistoryPerformance = (
  elapsedTimeMilli: number | undefined,
  capacityUnits?: number,
  dynamoDb?: RdhDynamoDbSummary
): SQLHistoryPerformance => {
  const capacity =
    capacityUnits !== undefined
      ? { capacitySampleCount: 1, totalCapacityUnits: capacityUnits, maxCapacityUnits: capacityUnits, lastCapacityUnits: capacityUnits }
      : {};
  const dynamoDbPerformance = mergeDynamoDbPerformance(undefined, dynamoDb);
  const initial =
    elapsedTimeMilli === undefined
      ? { ...EMPTY_PERFORMANCE, ...capacity }
      : {
          sampleCount: 1,
          totalElapsedTimeMilli: elapsedTimeMilli,
          maxElapsedTimeMilli: elapsedTimeMilli,
          lastElapsedTimeMilli: elapsedTimeMilli,
          ...capacity,
        };
  return dynamoDbPerformance ? { ...initial, dynamoDb: dynamoDbPerformance } : initial;
};

export const averageElapsedTimeMilli = (performance: SQLHistoryPerformance): number =>
  performance.sampleCount > 0 ? performance.totalElapsedTimeMilli / performance.sampleCount : 0;

export const averageCapacityUnits = (performance: SQLHistoryPerformance): number | undefined =>
  performance.capacitySampleCount && performance.capacitySampleCount > 0
    ? (performance.totalCapacityUnits ?? 0) / performance.capacitySampleCount
    : undefined;
