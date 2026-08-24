import type { SQLHistory, SQLHistoryPerformance } from "../types/SQLHistory";
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
  maxElapsedTimeMilli: 0,
  lastElapsedTimeMilli: 0,
};

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
): Pick<SQLHistoryPerformance, "capacitySampleCount" | "totalCapacityUnits" | "maxCapacityUnits" | "lastCapacityUnits"> => {
  if (capacityUnits === undefined) {
    return {
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

// Folds a new execution's elapsed time (and, additively, Capacity) into the
// previous entry's stats. Runs without a measurable duration (e.g. errors)
// leave the elapsed-time aggregates untouched, so failed re-runs don't skew
// avg/max; the Capacity aggregates follow the same rule independently via
// mergeCapacity().
export const mergeSQLHistoryPerformance = (
  previous: SQLHistory,
  elapsedTimeMilli: number | undefined,
  capacityUnits?: number
): SQLHistoryPerformance => {
  const base = migrateLegacyPerformance(previous);
  const capacity = mergeCapacity(base, capacityUnits);
  if (elapsedTimeMilli === undefined) {
    return { ...base, ...capacity };
  }
  return {
    sampleCount: base.sampleCount + 1,
    totalElapsedTimeMilli: base.totalElapsedTimeMilli + elapsedTimeMilli,
    maxElapsedTimeMilli: Math.max(base.maxElapsedTimeMilli, elapsedTimeMilli),
    lastElapsedTimeMilli: elapsedTimeMilli,
    ...capacity,
  };
};

export const createInitialSQLHistoryPerformance = (
  elapsedTimeMilli: number | undefined,
  capacityUnits?: number
): SQLHistoryPerformance => {
  const capacity =
    capacityUnits !== undefined
      ? { capacitySampleCount: 1, totalCapacityUnits: capacityUnits, maxCapacityUnits: capacityUnits, lastCapacityUnits: capacityUnits }
      : {};
  if (elapsedTimeMilli === undefined) {
    return { ...EMPTY_PERFORMANCE, ...capacity };
  }
  return {
    sampleCount: 1,
    totalElapsedTimeMilli: elapsedTimeMilli,
    maxElapsedTimeMilli: elapsedTimeMilli,
    lastElapsedTimeMilli: elapsedTimeMilli,
    ...capacity,
  };
};

export const averageElapsedTimeMilli = (performance: SQLHistoryPerformance): number =>
  performance.sampleCount > 0 ? performance.totalElapsedTimeMilli / performance.sampleCount : 0;

export const averageCapacityUnits = (performance: SQLHistoryPerformance): number | undefined =>
  performance.capacitySampleCount && performance.capacitySampleCount > 0
    ? (performance.totalCapacityUnits ?? 0) / performance.capacitySampleCount
    : undefined;
