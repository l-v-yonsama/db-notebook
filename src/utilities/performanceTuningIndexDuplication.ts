import type { IndexDefinition, PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";

// Deterministic backstop for the AI's own duplicate-index self-check (2026-08-21
// follow-up, scripts/performance-lab/aiResults/summary.md's Full Context
// improvement item 4). Round 1 testing found a real case (PostgreSQL slow-03)
// where the AI suggested `CREATE INDEX idx_products_category ON ... (category)`
// even though Full Context's own `tables[].definition.indexes` already listed
// that exact index - a live SQL error when the user ran it. The prompt now
// also asks the model to check this itself (performanceTuningAiPrompt.ts),
// but summary.md is explicit this should not be relied on alone - this
// utility re-checks the model's `suggestedSql` after the fact, independent of
// whether the model followed that instruction.
//
// Deliberately narrow scope: only flags a *verbatim* column-set match
// (same columns, same order) against an existing index - matching the actual
// failure mode observed, not a general redundant-index analyzer. A candidate
// that is a subset/superset/reordering of an existing index is NOT flagged -
// that is a fuzzier judgment call (a narrower single-column index can still
// be useful even with a wider composite index present) this utility does not
// attempt.
//
// Same "best-effort, unstructured input, nothing throws" posture as
// db-drivers' plan parsers: `suggestedSql` is free-text the model wrote, not
// a real SQL AST - a non-`CREATE INDEX` statement, an unparseable one, or a
// table this context doesn't know about all just return undefined rather
// than throwing.

export type PossibleDuplicateIndexMatch = {
  schemaName?: string;
  tableName: string;
  matchedIndexName: string;
};

// Matches "CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name> ON <schema.table|table> ("
// up to (and including) the column list's opening paren - tolerant of
// MySQL backtick / Postgres,Oracle double-quote / SQL Server bracket
// identifier quoting. The column list itself (which may contain its own
// nested parens, e.g. a functional index column like `LOWER(channel)`) is
// found by manually walking paren depth from here, not by this regex -
// see findMatchingCloseParen() below.
const QUOTED_OR_BARE = "(?:`[^`]+`|\"[^\"]+\"|\\[[^\\]]+\\]|\\S+)";
const CREATE_INDEX_HEADER = new RegExp(
  `^\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUOTED_OR_BARE}\\s+ON\\s+` +
    `((?:\`[^\`]+\`|"[^"]+"|\\[[^\\]]+\\]|\\w+)(?:\\s*\\.\\s*(?:\`[^\`]+\`|"[^"]+"|\\[[^\\]]+\\]|\\w+))?)\\s*\\(`,
  "i",
);

function findMatchingCloseParen(text: string, openIndex: number): number | undefined {
  // `openIndex` points just past the opening '(' (i.e. depth is already 1).
  let depth = 1;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    } else if (text[i] === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}

// Splits on top-level commas only, so a functional column's own internal
// comma-free parens (`LOWER(channel)`) never get split apart.
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function stripQuoting(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "`" && last === "`") || (first === '"' && last === '"') || (first === "[" && last === "]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const BARE_COLUMN_TOKEN = /^(`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+)(?:\s+(?:ASC|DESC))?$/i;

// Normalizes one candidate column-list token into a comparable key: a bare
// (optionally quoted, optionally ASC/DESC-suffixed) identifier becomes its
// lowercased column name; anything else (a functional/expression column
// like `LOWER(channel)`) becomes its whitespace-stripped, lowercased text -
// mirroring how the catalog mappers already split IndexColumnDefinition
// into columnName vs expression.
function normalizeColumnToken(token: string): string {
  const match = BARE_COLUMN_TOKEN.exec(token.trim());
  if (match) {
    return stripQuoting(match[1]).toLowerCase();
  }
  return token.replace(/\s+/g, "").toLowerCase();
}

function normalizeExistingIndexColumns(index: IndexDefinition): string[] {
  return index.columns.map((c) => {
    if (c.columnName) {
      return c.columnName.toLowerCase();
    }
    if (c.expression) {
      return c.expression.replace(/\s+/g, "").toLowerCase();
    }
    return "";
  });
}

function parseTableRef(ref: string): { schemaName?: string; tableName: string } {
  const parts = ref.split(".").map((p) => stripQuoting(p));
  return parts.length >= 2 ? { schemaName: parts[0], tableName: parts[1] } : { tableName: parts[0] };
}

// Same tolerant matching semantics as db-drivers' RDSBaseDriver.ts's own
// local isSameTable() (a private helper in that package, re-implemented
// here rather than imported): tableName compared case-insensitively;
// schemaName compared case-insensitively only when *both* sides have one -
// an unqualified reference matches a schema-qualified table.
function isSameTable(
  a: { schemaName?: string; tableName: string },
  b: { schemaName?: string; tableName: string },
): boolean {
  if (a.tableName.toLowerCase() !== b.tableName.toLowerCase()) {
    return false;
  }
  return a.schemaName && b.schemaName ? a.schemaName.toLowerCase() === b.schemaName.toLowerCase() : true;
}

export function findPossibleDuplicateIndex(
  suggestedSql: string | undefined,
  context: PerformanceTuningContext,
): PossibleDuplicateIndexMatch | undefined {
  if (!suggestedSql) {
    return undefined;
  }

  const header = CREATE_INDEX_HEADER.exec(suggestedSql);
  if (!header) {
    return undefined;
  }

  const openParenIndex = header.index + header[0].length;
  const closeParenIndex = findMatchingCloseParen(suggestedSql, openParenIndex);
  if (closeParenIndex === undefined) {
    return undefined;
  }

  const candidateColumns = splitTopLevel(suggestedSql.slice(openParenIndex, closeParenIndex)).map(
    normalizeColumnToken,
  );
  if (candidateColumns.length === 0) {
    return undefined;
  }

  const targetTableRef = parseTableRef(header[1]);
  const table = context.tables.find((t) => isSameTable({ schemaName: t.schemaName, tableName: t.tableName }, targetTableRef));
  if (!table?.definition) {
    return undefined;
  }

  for (const existingIndex of table.definition.indexes) {
    const existingColumns = normalizeExistingIndexColumns(existingIndex);
    if (
      existingColumns.length === candidateColumns.length &&
      existingColumns.every((c, i) => c === candidateColumns[i])
    ) {
      return { schemaName: table.schemaName, tableName: table.tableName, matchedIndexName: existingIndex.indexName };
    }
  }
  return undefined;
}
