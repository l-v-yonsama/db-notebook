import type { ActualPlanArtifact, PlanNode, PlanTableMapping } from "@l-v-yonsama/multi-platform-database-drivers";

// Formats plan data once for the Preview and saved notebook. The normalized
// plan remains an indented tree; table mappings are rendered as table rows.

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

function formatPlanTableMappingReference(mapping: Pick<PlanTableMapping, "schemaName" | "tableName" | "alias">): string {
  const qualified = [mapping.schemaName, mapping.tableName].filter(Boolean).join(".");
  return mapping.alias && mapping.alias !== mapping.tableName ? `${qualified} ${mapping.alias}` : qualified;
}

// Normalized nodes can include structured actual values where the driver can
// associate runtime evidence with individual nodes.
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

// Include every available attribute because vendors split plan information
// differently across operation, relation, index, and join type.
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

/**
 * Makes a database-native XML plan readable without changing the artifact
 * retained in PerformanceTuningContext (and therefore in Full Context JSON).
 * SQL Server returns SET STATISTICS XML as one long string; a display-only
 * indentation pass is enough here and deliberately avoids parsing or
 * rewriting values embedded in the plan's attributes.
 */
export function formatActualPlanForDisplay(actualPlan: ActualPlanArtifact | undefined): string | undefined {
  if (!actualPlan) {
    return undefined;
  }
  if (actualPlan.format !== "xml") {
    return actualPlan.content;
  }

  const compact = actualPlan.content.trim().replace(/>\s+</g, "><");
  const tokens = compact.match(/<[^>]+>|[^<]+/g);
  if (!tokens) {
    return actualPlan.content;
  }
  const lines: string[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (!token.trim()) {
      continue;
    }
    if (/^<\//.test(token)) {
      depth = Math.max(0, depth - 1);
      lines.push(`${"  ".repeat(depth)}${token}`);
    } else if (/^<\?/.test(token) || /^<!/.test(token) || /\/>$/.test(token)) {
      lines.push(`${"  ".repeat(depth)}${token}`);
    } else if (/^</.test(token)) {
      lines.push(`${"  ".repeat(depth)}${token}`);
      depth++;
    } else {
      lines.push(`${"  ".repeat(depth)}${token}`);
    }
  }
  return lines.join("\n");
}

export type PlanTableMappingRow = {
  table: string;
  index?: string;
  estimatedRows?: number;
  // Populated under analyze mode only when a vendor's runtime artifact can
  // be safely matched to the estimate mapping. Postgres carries it directly;
  // MySQL, Oracle, and SQL Server resolve it from their native artifacts.
  actualRows?: number;
  rowEstimateRatio?: number;
  tableAccessFraction?: number;
  predicateFilterSelectivity?: number;
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
 * `actualRows`/`rowEstimateRatio` pass through as-is - undefined for an
 * estimate-mode mapping or when an analyzed vendor artifact cannot be
 * safely resolved to the mapping, a real number otherwise.
 */
export function buildPlanTableMappingRows(mappings: PlanTableMapping[]): PlanTableMappingRow[] {
  return mappings.map((mapping) => {
    return {
      table: formatPlanTableMappingReference(mapping),
      index: mapping.indexName,
      estimatedRows: mapping.estimatedRows,
      actualRows: mapping.actualRows,
      rowEstimateRatio: mapping.rowEstimateRatio,
      tableAccessFraction: mapping.tableAccessFraction?.value,
      predicateFilterSelectivity: mapping.predicateFilterSelectivity?.value,
      columnsUsed: combineColumns(mapping),
    };
  });
}
