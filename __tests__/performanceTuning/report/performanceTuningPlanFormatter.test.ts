import type { PlanNode, PlanTableMapping } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  buildPlanTableMappingRows,
  formatActualPlanForDisplay,
  formatPlanTree,
} from "../../../src/performanceTuning/report/performanceTuningPlanFormatter";

describe("formatPlanTree", () => {
  it("renders a single leaf node with no branch prefix", () => {
    const plan: PlanNode = {
      id: "n0",
      depth: 0,
      operation: "Seq Scan",
      relation: { schemaName: "public", tableName: "orders", alias: "orders" },
      estimated: { startupCost: 0, totalCost: 48210, rows: 41, width: 96 },
      children: [],
    };
    expect(formatPlanTree(plan)).toBe("Seq Scan  on public.orders  (cost=0..48210 rows=41 width=96)");
  });

  it("renders a join with two scan children using box-drawing branches, and predicates as an indented sub-line", () => {
    const plan: PlanNode = {
      id: "n0",
      depth: 0,
      operation: "Hash Join",
      joinType: "Inner",
      estimated: { startupCost: 0, totalCost: 8.2, rows: 41 },
      children: [
        {
          id: "n1",
          depth: 1,
          operation: "Seq Scan",
          relation: { schemaName: "public", tableName: "orders", alias: "o" },
          predicates: ["tenant_id = 42", "status = 'PENDING'"],
          estimated: { startupCost: 0, totalCost: 1.0, rows: 50 },
          children: [],
        },
        {
          id: "n2",
          depth: 1,
          operation: "Hash",
          children: [
            {
              id: "n3",
              depth: 2,
              operation: "Index Scan",
              indexName: "customers_pkey",
              relation: { schemaName: "public", tableName: "customers", alias: "c" },
              estimated: { startupCost: 0, totalCost: 0.5, rows: 10 },
              children: [],
            },
          ],
        },
      ],
    };

    const text = formatPlanTree(plan);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Hash Join  (cost=0..8.2 rows=41)  [Inner]");
    expect(lines[1]).toBe("├─ Seq Scan  on public.orders o  (cost=0..1 rows=50)");
    expect(lines[2]).toContain("filter: tenant_id = 42, status = 'PENDING'");
    expect(lines[2].startsWith("│")).toBe(true);
    expect(lines[3]).toBe("└─ Hash");
    expect(lines[4]).toBe("   └─ Index Scan  on public.customers c  using customers_pkey  (cost=0..0.5 rows=10)");
  });

  it("composes MySQL's bare access_type operation with relation/index rather than printing operation alone", () => {
    const plan: PlanNode = {
      id: "n0",
      depth: 0,
      operation: "ref",
      relation: { tableName: "perf_orders" },
      indexName: "idx_status",
      estimated: { rows: 10, totalCost: 5.25 },
      children: [],
    };
    expect(formatPlanTree(plan)).toBe("ref  on perf_orders  using idx_status  (cost=?..5.25 rows=10)");
  });

  it("keeps Oracle's merged TABLE ACCESS + INDEX pair as two separate tree lines", () => {
    const plan: PlanNode = {
      id: "n0",
      depth: 0,
      operation: "TABLE ACCESS BY INDEX ROWID BATCHED",
      relation: { schemaName: "TESTUSER", tableName: "PERF_ORDERS" },
      estimated: { rows: 50 },
      children: [
        {
          id: "n1",
          depth: 1,
          operation: "INDEX RANGE SCAN",
          indexName: "IDX_PERF_ORDERS_STATUS",
          children: [],
        },
      ],
    };
    const lines = formatPlanTree(plan).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("TABLE ACCESS BY INDEX ROWID BATCHED  on TESTUSER.PERF_ORDERS  (rows=50)");
    expect(lines[1]).toBe("└─ INDEX RANGE SCAN  using IDX_PERF_ORDERS_STATUS");
  });

  it("omits the alias from the relation ref when it equals the table name", () => {
    const plan: PlanNode = {
      id: "n0",
      depth: 0,
      operation: "Seq Scan",
      relation: { tableName: "orders", alias: "orders" },
      children: [],
    };
    expect(formatPlanTree(plan)).toBe("Seq Scan  on orders");
  });
});

describe("buildPlanTableMappingRows", () => {
  it("joins schema/table/alias and combines filter/join/group/sort columns into one labeled cell", () => {
    const mappings: PlanTableMapping[] = [
      {
        planNodeId: "n1",
        schemaName: "public",
        tableName: "orders",
        alias: "o",
        indexName: "idx_status",
        estimatedRows: 50,
        filterColumns: ["status", "tenant_id"],
        joinColumns: ["customer_id"],
      },
    ];
    expect(buildPlanTableMappingRows(mappings)).toEqual([
      {
        table: "public.orders o",
        index: "idx_status",
        estimatedRows: 50,
        columnsUsed: "filter: status, tenant_id / join: customer_id",
      },
    ]);
  });

  it("leaves columnsUsed undefined when no filter/join/group/sort columns are present", () => {
    const mappings: PlanTableMapping[] = [
      { planNodeId: "n1", tableName: "customers" },
    ];
    expect(buildPlanTableMappingRows(mappings)[0].columnsUsed).toBeUndefined();
  });

  it("returns an empty array for an empty input", () => {
    expect(buildPlanTableMappingRows([])).toEqual([]);
  });

  it("carries actual-row and separated selectivity metrics through for an analyze-mode mapping", () => {
    const mappings: PlanTableMapping[] = [
      {
        planNodeId: "n1",
        tableName: "orders",
        estimatedRows: 50,
        actualRows: 37,
        rowEstimateRatio: 0.74,
        tableAccessFraction: { value: 0.1, estimated: false, source: "test" },
        predicateFilterSelectivity: { value: 0.37, estimated: false, source: "test" },
      },
    ];
    expect(buildPlanTableMappingRows(mappings)[0]).toMatchObject({
      estimatedRows: 50,
      actualRows: 37,
      rowEstimateRatio: 0.74,
      tableAccessFraction: 0.1,
      predicateFilterSelectivity: 0.37,
    });
  });

  it("leaves actualRows/rowEstimateRatio undefined for an estimate-mode mapping", () => {
    const mappings: PlanTableMapping[] = [{ planNodeId: "n1", tableName: "orders", estimatedRows: 50 }];
    const row = buildPlanTableMappingRows(mappings)[0];
    expect(row.actualRows).toBeUndefined();
    expect(row.rowEstimateRatio).toBeUndefined();
  });
});

describe("formatActualPlanForDisplay", () => {
  it("indents a one-line SQL Server STATISTICS XML artifact for the panel without changing text artifacts", () => {
    expect(
      formatActualPlanForDisplay({
        source: "SET STATISTICS XML",
        format: "xml",
        content: '<ShowPlanXML><RelOp NodeId="8"><IndexScan><Object Table="[orders]" /></IndexScan></RelOp></ShowPlanXML>',
      }),
    ).toBe(
      [
        "<ShowPlanXML>",
        '  <RelOp NodeId="8">',
        "    <IndexScan>",
        '      <Object Table="[orders]" />',
        "    </IndexScan>",
        "  </RelOp>",
        "</ShowPlanXML>",
      ].join("\n"),
    );
    expect(
      formatActualPlanForDisplay({ source: "EXPLAIN ANALYZE", format: "text", content: "-> Table scan" }),
    ).toBe("-> Table scan");
  });
});
