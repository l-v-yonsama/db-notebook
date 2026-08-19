import type {
  PlanNode,
  PlanTableMapping,
} from "@l-v-yonsama/multi-platform-database-drivers";

// Renders getPerformanceTuningContext()'s execution-plan data readably for
// both surfaces that show it (PerformanceTuningPreviewPanel.vue,
// performanceTuningAiNotebook.ts's generated .dbn) - see
// misc/design/performance-tuning-structured-ai-analysis-plan.ja.md's
// "execution plan display" follow-up (2026-08-19) for the design rationale.
// Pure/vscode-free, same discipline as performanceTuningDiagnosticFormatter.ts:
// a single formatter, called once host-side, both surfaces just display its
// output as-is (no per-surface re-derivation).
//
// Two different renderers for two different data shapes: normalizedPlan is a
// *tree* (a table would lose the parent-child structure that's the whole
// point of an execution plan), so it's rendered as a classic EXPLAIN-style
// indented text tree instead. planTableMappings is a genuinely *flat* array
// (one row per table/index the plan touches), so that one does become a
// table - see buildPlanTableMappingRows() below.

const BRANCH = "├─ ";
const LAST_BRANCH = "└─ ";
const PIPE = "│  ";
const BLANK = "   ";
const DETAIL_INDENT = "   ";

function formatTableRef(relation: PlanNode["relation"]): string | undefined {
  if (!relation?.tableName) {
    return undefined;
  }
  const qualified = [relation.schemaName, relation.tableName].filter(Boolean).join(".");
  return relation.alias && relation.alias !== relation.tableName
    ? `${qualified} ${relation.alias}`
    : qualified;
}

// Postgres's own EXPLAIN cost notation, reused verbatim (instantly familiar
// to the majority of this project's users) rather than inventing a new one.
// The same slot doubles for `actual` once analyze mode ships in db-drivers
// (not implemented in any Provider today, per investigation) - no format
// change needed then, just a second call with the `actual time=...` variant.
function formatEstimated(estimated: PlanNode["estimated"]): string | undefined {
  if (!estimated) {
    return undefined;
  }
  const parts: string[] = [];
  if (estimated.startupCost !== undefined || estimated.totalCost !== undefined) {
    parts.push(`cost=${estimated.startupCost ?? "?"}..${estimated.totalCost ?? "?"}`);
  }
  if (estimated.rows !== undefined) {
    parts.push(`rows=${estimated.rows}`);
  }
  if (estimated.width !== undefined) {
    parts.push(`width=${estimated.width}`);
  }
  return parts.length > 0 ? `(${parts.join(" ")})` : undefined;
}

function formatActual(actual: PlanNode["actual"]): string | undefined {
  if (!actual) {
    return undefined;
  }
  const parts: string[] = [];
  if (actual.startupMs !== undefined || actual.totalMs !== undefined) {
    parts.push(`time=${actual.startupMs ?? "?"}..${actual.totalMs ?? "?"}`);
  }
  if (actual.rows !== undefined) {
    parts.push(`rows=${actual.rows}`);
  }
  if (actual.loops !== undefined) {
    parts.push(`loops=${actual.loops}`);
  }
  return parts.length > 0 ? `(actual ${parts.join(" ")})` : undefined;
}

// One line per node, composed from operation + relation + indexName +
// joinType - operation alone isn't self-sufficient across vendors (MySQL's
// is a bare access_type like "ref"/"ALL"; SQL Server splits joinType out
// separately from the physical op) so every available piece is included.
function formatNodeLine(node: PlanNode): string {
  const parts: string[] = [node.operation];

  const tableRef = formatTableRef(node.relation);
  if (tableRef) {
    parts.push(`on ${tableRef}`);
  }
  if (node.indexName) {
    parts.push(`using ${node.indexName}`);
  }

  const estimated = formatEstimated(node.estimated);
  if (estimated) {
    parts.push(estimated);
  }
  const actual = formatActual(node.actual);
  if (actual) {
    parts.push(actual);
  }
  if (node.joinType) {
    parts.push(`[${node.joinType}]`);
  }

  return parts.join("  ");
}

function appendNode(lines: string[], node: PlanNode, prefix: string, isLast: boolean, isRoot: boolean): void {
  const branch = isRoot ? "" : isLast ? LAST_BRANCH : BRANCH;
  lines.push(`${prefix}${branch}${formatNodeLine(node)}`);

  const childPrefix = isRoot ? "" : prefix + (isLast ? BLANK : PIPE);

  if (node.predicates && node.predicates.length > 0) {
    lines.push(`${childPrefix}${DETAIL_INDENT}filter: ${node.predicates.join(", ")}`);
  }

  node.children.forEach((child, i) => {
    appendNode(lines, child, childPrefix, i === node.children.length - 1, false);
  });
}

/**
 * Renders a PlanNode tree as an indented EXPLAIN-style text tree - see this
 * file's top comment. Deterministic string in, string out; no vscode/DOM
 * dependency, so both the Vue panel (<pre>) and the generated Notebook
 * (```text fenced block) render this same output unmodified.
 */
export function formatPlanTree(plan: PlanNode): string {
  const lines: string[] = [];
  appendNode(lines, plan, "", true, true);
  return lines.join("\n");
}

export type PlanTableMappingRow = {
  table: string;
  index?: string;
  estimatedRows?: number;
  columnsUsed?: string;
};

function combineColumns(mapping: PlanTableMapping): string | undefined {
  const groups: Array<[string, string[] | undefined]> = [
    ["filter", mapping.filterColumns],
    ["join", mapping.joinColumns],
    ["group", mapping.groupColumns],
    ["sort", mapping.sortColumns],
  ];
  const parts = groups
    .filter(([, columns]) => columns && columns.length > 0)
    .map(([label, columns]) => `${label}: ${columns!.join(", ")}`);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

/**
 * planTableMappings is already flat (one entry per table/index the plan
 * touches), so unlike the tree above this one genuinely suits a table.
 * `actualRows`/`rowEstimateRatio` are deliberately not included here - both
 * are always empty today (same "analyze mode isn't implemented yet" reason
 * as PlanNode.actual above), so a column that can never have data would just
 * be dead weight until db-drivers ships it.
 */
export function buildPlanTableMappingRows(mappings: PlanTableMapping[]): PlanTableMappingRow[] {
  return mappings.map((mapping) => {
    const qualified = [mapping.schemaName, mapping.tableName].filter(Boolean).join(".");
    const table = mapping.alias && mapping.alias !== mapping.tableName ? `${qualified} ${mapping.alias}` : qualified;
    return {
      table,
      index: mapping.indexName,
      estimatedRows: mapping.estimatedRows,
      columnsUsed: combineColumns(mapping),
    };
  });
}
