import type {
  PerformanceTuningContext,
  PlanTableMapping,
  TableTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { hasActualExecutionEvidence } from "../../shared/PerformanceTuningActualEvidence";
import type {
  PerformanceTuningHumanSignal,
  PerformanceTuningHumanSummary,
} from "../../shared/PerformanceTuningHumanSummary";

const POSTGRES_DEAD_TUPLES_ATTENTION = 1_000;
const POSTGRES_DEAD_TUPLE_RATIO_ATTENTION = 0.1;
const STATS_MODIFICATIONS_ATTENTION = 1_000;
const STATS_MODIFICATIONS_RATIO_ATTENTION = 0.1;
const SQLSERVER_FRAGMENTATION_INFO_PERCENT = 10;
const SQLSERVER_FRAGMENTATION_ATTENTION_PERCENT = 30;
const SQLSERVER_FRAGMENTATION_MIN_PAGES = 1_000;

const eq = (left: string | undefined, right: string | undefined): boolean =>
  (left ?? "").toLocaleLowerCase() === (right ?? "").toLocaleLowerCase();

function tableName(schemaName: string | undefined, name: string): string {
  return [schemaName, name].filter(Boolean).join(".");
}

function mappingRef(mapping: PlanTableMapping): string {
  const physical = tableName(mapping.schemaName, mapping.tableName);
  return mapping.alias && !eq(mapping.alias, mapping.tableName)
    ? `${physical} (alias ${mapping.alias})`
    : physical;
}

function tableRef(table: TableTuningContext): string {
  return tableName(table.schemaName, table.tableName);
}

function findTable(context: PerformanceTuningContext, mapping: PlanTableMapping): TableTuningContext | undefined {
  const matches = context.tables.filter((table) => eq(table.tableName, mapping.tableName));
  return matches.find((table) => eq(table.schemaName, mapping.schemaName)) ??
    (matches.length === 1 ? matches[0] : undefined);
}

function metricNumber(table: TableTuningContext, name: string): number | undefined {
  const value = table.physicalHealth?.metrics.find((metric) => eq(metric.name, name))?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberText(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function percentText(value: number): string {
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function healthPath(table: TableTuningContext): string {
  return `Full context JSON → tables → ${tableRef(table)} → physicalHealth.metrics / statistics`;
}

function buildEstimateSignals(context: PerformanceTuningContext): PerformanceTuningHumanSignal[] {
  const diagnostics = context.collection.diagnostics.filter(
    (diagnostic) => diagnostic.code === "CARDINALITY_MISESTIMATE",
  );
  if (diagnostics.length > 0) {
    return diagnostics.map((diagnostic) => {
      const cardinality = diagnostic.cardinality;
      const ref = diagnostic.tableName
        ? tableName(diagnostic.schemaName, diagnostic.tableName)
        : undefined;
      const summary = cardinality
        ? `${ref ?? "Plan output"}: estimated ${numberText(cardinality.estimatedRows)} rows → actual ${numberText(cardinality.actualRows)} rows (${numberText(cardinality.actualToEstimatedRatio)}x). The optimizer estimate differs materially from the measured result.`
        : diagnostic.message;
      return {
        kind: "estimateAccuracy",
        level: "attention",
        title: "Estimate accuracy needs review",
        summary,
        tableRef: ref,
        rawDataPath: `Full context JSON → collection.diagnostics → CARDINALITY_MISESTIMATE${
          ref ? ` / planTableMappings → ${ref}` : ""
        }`,
      };
    });
  }

  const hasActualRows = context.statement.analyzeEligibility?.allowed !== false &&
    context.planTableMappings.some((mapping) => mapping.actualRows !== undefined);
  return [
    {
      kind: "estimateAccuracy",
      level: hasActualRows ? "info" : "unknown",
      title: "Estimate accuracy",
      summary: hasActualRows
        ? "No large estimate mismatch was detected in the resolved table-level runtime rows."
        : context.statement.analyzeEligibility?.allowed === false
          ? "Not measured — this DML statement uses an estimated plan only."
          : "Not measured — table-level actual rows were not available.",
      rawDataPath: "Full context JSON → planTableMappings / collection.diagnostics",
    },
  ];
}

function postgresHealth(table: TableTuningContext): PerformanceTuningHumanSignal {
  const deadTuples = metricNumber(table, "deadTuples");
  const deadRatio = metricNumber(table, "deadTupleRatio");
  const modifications = metricNumber(table, "modificationsSinceAnalyze") ??
    table.statistics?.modificationsSinceAnalyze?.value;
  const estimatedRows = table.statistics?.estimatedRowCount?.value;
  const concerns: string[] = [];
  if (
    deadTuples !== undefined && deadRatio !== undefined &&
    deadTuples >= POSTGRES_DEAD_TUPLES_ATTENTION &&
    deadRatio >= POSTGRES_DEAD_TUPLE_RATIO_ATTENTION
  ) {
    concerns.push(
      `${numberText(deadTuples)} dead tuples (${percentText(deadRatio)}) may justify reviewing routine VACUUM behavior; this alone does not justify VACUUM FULL.`,
    );
  }
  if (
    modifications !== undefined && estimatedRows !== undefined && estimatedRows > 0 &&
    modifications >= STATS_MODIFICATIONS_ATTENTION &&
    modifications / estimatedRows >= STATS_MODIFICATIONS_RATIO_ATTENTION
  ) {
    concerns.push(
      `${numberText(modifications)} modifications since ANALYZE (${percentText(modifications / estimatedRows)} of estimated rows) may justify reviewing statistics freshness.`,
    );
  }
  if (concerns.length > 0) {
    return {
      kind: "tableHealth",
      level: "attention",
      title: "Table health needs review",
      summary: concerns.join(" "),
      tableRef: tableRef(table),
      rawDataPath: healthPath(table),
    };
  }
  if (deadTuples === undefined && modifications === undefined) {
    return unavailableHealth(table);
  }
  return {
    kind: "tableHealth",
    level: "info",
    title: "No notable maintenance signal",
    summary: `Collected PostgreSQL health metrics for ${tableRef(table)} did not cross the conservative dead-tuple or statistics-change thresholds.`,
    tableRef: tableRef(table),
    rawDataPath: healthPath(table),
  };
}

function sqlServerHealth(table: TableTuningContext): PerformanceTuningHumanSignal {
  const fragmentation = metricNumber(table, "avgFragmentationPercent");
  const pageCount = metricNumber(table, "pageCount");
  if (fragmentation === undefined || pageCount === undefined) {
    return unavailableHealth(table);
  }
  const level = pageCount >= SQLSERVER_FRAGMENTATION_MIN_PAGES &&
    fragmentation >= SQLSERVER_FRAGMENTATION_ATTENTION_PERCENT
    ? "attention"
    : "info";
  const summary = pageCount < SQLSERVER_FRAGMENTATION_MIN_PAGES
    ? `Fragmentation is ${numberText(fragmentation)}% across ${numberText(pageCount)} pages; the object is below the page-count threshold, so fragmentation alone is not treated as actionable.`
    : fragmentation >= SQLSERVER_FRAGMENTATION_ATTENTION_PERCENT
      ? `Fragmentation is ${numberText(fragmentation)}% across ${numberText(pageCount)} pages. Review the affected heap/clustered index and workload before choosing reorganize or rebuild.`
      : fragmentation >= SQLSERVER_FRAGMENTATION_INFO_PERCENT
        ? `Fragmentation is ${numberText(fragmentation)}% across ${numberText(pageCount)} pages. This is informational and does not by itself require maintenance.`
        : `Fragmentation is ${numberText(fragmentation)}% across ${numberText(pageCount)} pages; no notable fragmentation signal was detected.`;
  return {
    kind: "tableHealth",
    level,
    title: level === "attention" ? "Table health needs review" : "Table health",
    summary,
    tableRef: tableRef(table),
    rawDataPath: healthPath(table),
  };
}

function mysqlHealth(table: TableTuningContext): PerformanceTuningHumanSignal {
  const dataFree = metricNumber(table, "dataFreeBytes");
  if (dataFree === undefined) {
    return unavailableHealth(table);
  }
  const tableBytes = table.statistics?.tableBytes?.value;
  const ratio = tableBytes !== undefined && tableBytes > 0 ? dataFree / tableBytes : undefined;
  return {
    kind: "tableHealth",
    level: "info",
    title: "MySQL free-space observation",
    summary: `DATA_FREE is ${numberText(dataFree)} bytes${ratio !== undefined ? ` (${percentText(ratio)} of table bytes)` : ""}. This can reflect a shared/general tablespace and does not by itself justify OPTIMIZE TABLE.`,
    tableRef: tableRef(table),
    rawDataPath: healthPath(table),
  };
}

function oracleHealth(table: TableTuningContext): PerformanceTuningHumanSignal {
  const chainedRows = metricNumber(table, "chainedRowCount");
  if (chainedRows === undefined) {
    return unavailableHealth(table);
  }
  return {
    kind: "tableHealth",
    level: "info",
    title: "Oracle chained-row observation",
    summary: `CHAIN_CNT is ${numberText(chainedRows)}. It is updated by legacy ANALYZE rather than DBMS_STATS and may be stale; this value alone does not justify moving the table.`,
    tableRef: tableRef(table),
    rawDataPath: healthPath(table),
  };
}

function unavailableHealth(table: TableTuningContext): PerformanceTuningHumanSignal {
  return {
    kind: "tableHealth",
    level: "unknown",
    title: "Table health not available",
    summary: `No vendor-specific physical-health metric was available for ${tableRef(table)}; absence of metrics is not evidence that the table is healthy.`,
    tableRef: tableRef(table),
    rawDataPath: healthPath(table),
  };
}

function buildHealthSignals(context: PerformanceTuningContext): PerformanceTuningHumanSignal[] {
  const vendor = context.database.vendor.toLocaleLowerCase();
  return context.tables.map((table) => {
    if (vendor.includes("postgre")) {
      return postgresHealth(table);
    }
    if (vendor.includes("sqlserver") || vendor.includes("sql server") || vendor.includes("mssql")) {
      return sqlServerHealth(table);
    }
    if (vendor.includes("mysql")) {
      return mysqlHealth(table);
    }
    if (vendor.includes("oracle")) {
      return oracleHealth(table);
    }
    return unavailableHealth(table);
  });
}

export function buildPerformanceTuningHumanSummary(
  context: PerformanceTuningContext,
): PerformanceTuningHumanSummary {
  const mappingRefs = context.planTableMappings.map(mappingRef);
  const refs = mappingRefs.length > 0 ? mappingRefs : context.tables.map(tableRef);
  const tableRefs = [...new Set(refs)];
  const actual = hasActualExecutionEvidence(context);

  const collectionSignal: PerformanceTuningHumanSignal[] = context.collection.status === "partial"
    ? [{
        kind: "collection",
        level: "attention",
        title: "Collection is partial",
        summary: `${context.collection.unavailableSections.length} section(s) were unavailable and/or collection diagnostics affected completeness.`,
        rawDataPath: "Full context JSON → collection.unavailableSections / collection.diagnostics",
      }]
    : [];

  return {
    profile: {
      statementKind: (context.statement.kind ?? "other").toLocaleUpperCase(),
      evidence: actual ? "actual" : "estimate",
      tableCount: tableRefs.length,
      tableRefs,
      collectionStatus: context.collection.status,
    },
    signals: [
      ...collectionSignal,
      ...buildEstimateSignals(context),
      ...buildHealthSignals(context),
    ],
    rowFlows: context.planTableMappings.map((mapping) => {
      const estimatedRowCount = findTable(context, mapping)?.statistics?.estimatedRowCount;
      return {
        tableRef: mappingRef(mapping),
        totalRows: estimatedRowCount?.value,
        totalRowsEstimated: estimatedRowCount?.estimated,
        accessedRows: mapping.tableAccessRows?.value,
        filterInputRows: mapping.predicateFilterInputRows?.value,
        filterOutputRows: mapping.predicateFilterOutputRows?.value,
        planOutputRows: mapping.actualRows,
        accessFraction: mapping.tableAccessFraction?.value,
        filterPassRate: mapping.predicateFilterSelectivity?.value,
        valuesAreActual: context.statement.analyzeEligibility?.allowed !== false && (
          mapping.actualRows !== undefined ||
          mapping.tableAccessRows?.estimated === false ||
          mapping.predicateFilterInputRows?.estimated === false ||
          mapping.predicateFilterOutputRows?.estimated === false
        ),
        rawDataPath: `Full context JSON → planTableMappings → ${mappingRef(mapping)}`,
      };
    }),
  };
}
