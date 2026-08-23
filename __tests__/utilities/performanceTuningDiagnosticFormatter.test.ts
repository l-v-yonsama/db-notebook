import type {
  PerformanceTuningDiagnostic,
  UnavailableSection,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { buildPerformanceTuningDiagnosticGroups } from "../../src/utilities/performanceTuningDiagnosticFormatter";

// Two non-table PostgreSQL plan sources should share one user-facing group.
const n3n4Diagnostics: PerformanceTuningDiagnostic[] = [
  {
    code: "NON_TABLE_PLAN_SOURCE",
    severity: "info",
    affectsCompleteness: false,
    scope: "executionPlan",
    message: "Plan node n3 (Function Scan) reads from a non-table source.",
    node: { id: "n3", operation: "Function Scan", objectKind: "function", objectName: "pg_stat_statements_info" },
  },
  {
    code: "NON_TABLE_PLAN_SOURCE",
    severity: "info",
    affectsCompleteness: false,
    scope: "executionPlan",
    message: "Plan node n4 (Function Scan) reads from a non-table source.",
    node: { id: "n4", operation: "Function Scan", objectKind: "function", objectName: "pg_stat_statements" },
  },
];

describe("buildPerformanceTuningDiagnosticGroups", () => {
  it("groups the n3/n4 Function Scan case into a single beginner-facing summary", () => {
    const groups = buildPerformanceTuningDiagnosticGroups(n3n4Diagnostics, []);

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.severity).toBe("info");
    // No action required, and no jargon like "warning"/"failed" in the summary.
    expect(group.summary).toContain("No action is required");
    expect(group.summary.toLowerCase()).not.toContain("fail");
  });

  it("keeps both n3 and n4 - with their node IDs and function names - in the group's details", () => {
    const [group] = buildPerformanceTuningDiagnosticGroups(n3n4Diagnostics, []);

    expect(group.details).toEqual([
      expect.objectContaining({ nodeId: "n3", operation: "Function Scan", objectName: "pg_stat_statements_info" }),
      expect.objectContaining({ nodeId: "n4", operation: "Function Scan", objectName: "pg_stat_statements" }),
    ]);
  });

  it("never drops a diagnostic: every input entry appears in exactly one group's details", () => {
    const groups = buildPerformanceTuningDiagnosticGroups(n3n4Diagnostics, []);
    const totalDetails = groups.reduce((sum, g) => sum + g.details.length, 0);
    expect(totalDetails).toBe(n3n4Diagnostics.length);
  });

  it("keeps node ID and operation even when the object name is unavailable", () => {
    const diagnostics: PerformanceTuningDiagnostic[] = [
      {
        code: "NON_TABLE_PLAN_SOURCE",
        severity: "info",
        affectsCompleteness: false,
        scope: "executionPlan",
        message: "Plan node n0 (Values Scan) reads from a non-table source.",
        node: { id: "n0", operation: "Values Scan", objectKind: "values" }, // no objectName
      },
    ];

    const [group] = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
    expect(group.details[0]).toEqual(
      expect.objectContaining({ nodeId: "n0", operation: "Values Scan", objectName: undefined }),
    );
  });

  it("does not merge different object kinds into the same group", () => {
    const diagnostics: PerformanceTuningDiagnostic[] = [
      {
        code: "NON_TABLE_PLAN_SOURCE",
        severity: "info",
        affectsCompleteness: false,
        scope: "executionPlan",
        message: "function",
        node: { id: "n1", operation: "Function Scan", objectKind: "function", objectName: "f" },
      },
      {
        code: "NON_TABLE_PLAN_SOURCE",
        severity: "info",
        affectsCompleteness: false,
        scope: "executionPlan",
        message: "cte",
        node: { id: "n2", operation: "CTE Scan", objectKind: "cte", objectName: "recent_orders" },
      },
    ];

    const groups = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
    expect(groups).toHaveLength(2);
  });

  it("separates info and warning severities, sorting information first", () => {
    const diagnostics: PerformanceTuningDiagnostic[] = [
      {
        code: "TABLE_MAPPING_FAILED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "executionPlan",
        message: "Could not resolve a table for plan node n5 (Some Future Scan).",
        node: { id: "n5", operation: "Some Future Scan" },
      },
      ...n3n4Diagnostics,
    ];

    const groups = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
    expect(groups.map((g) => g.severity)).toEqual(["info", "warning"]);
  });

  it("gives a warning group a summary describing continuation and impact", () => {
    const diagnostics: PerformanceTuningDiagnostic[] = [
      {
        code: "SECTION_COLLECTION_FAILED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "columnStatistics",
        message: "permission denied for view pg_stats",
        schemaName: "public",
        tableName: "orders",
        section: "columnStatistics",
      },
    ];

    const [group] = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
    expect(group.severity).toBe("warning");
    expect(group.summary).toContain("public.orders");
    expect(group.summary).toContain("analysis can continue");
    // The raw DB error text is technical detail, not the beginner summary line.
    expect(group.summary).not.toContain("permission denied");
    expect(group.details[0].technicalMessage).toContain("permission denied");
  });

  it("groups SECTION_COLLECTION_FAILED per table, not across every table at once", () => {
    const diagnostics: PerformanceTuningDiagnostic[] = [
      {
        code: "SECTION_COLLECTION_FAILED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "tableStatistics",
        message: "caveat A",
        schemaName: "public",
        tableName: "orders",
        section: "tableStatistics",
      },
      {
        code: "SECTION_COLLECTION_FAILED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "tableStatistics",
        message: "caveat B",
        schemaName: "public",
        tableName: "customers",
        section: "tableStatistics",
      },
    ];

    const groups = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.summary).join(" ")).toContain("public.orders");
    expect(groups.map((g) => g.summary).join(" ")).toContain("public.customers");
  });

  it("never produces the double-article 'Some the ...' text for a tableDefinition-scoped group (review finding)", () => {
    const sectionCollectionFailed: PerformanceTuningDiagnostic[] = [
      {
        code: "SECTION_COLLECTION_FAILED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "tableDefinition",
        message: "constraints unavailable",
        schemaName: "public",
        tableName: "orders",
        section: "tableDefinition",
      },
    ];
    const collectionTruncated: PerformanceTuningDiagnostic[] = [
      {
        code: "COLLECTION_TRUNCATED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "tableDefinition",
        message: "Columns truncated to 40 of 87.",
        schemaName: "public",
        tableName: "orders",
        section: "tableDefinition",
      },
    ];

    for (const diagnostics of [sectionCollectionFailed, collectionTruncated]) {
      const [group] = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
      expect(group.summary).not.toMatch(/\bSome the\b/);
      expect(group.summary).toContain("table definition details for public.orders");
    }
  });

  it("falls back to the driver's own message for an unrecognized code instead of dropping it", () => {
    const diagnostics = [
      {
        code: "SOME_FUTURE_CODE",
        severity: "warning",
        affectsCompleteness: true,
        scope: "collection",
        message: "A brand-new kind of diagnostic this UI does not know about yet.",
      },
    ] as unknown as PerformanceTuningDiagnostic[];

    const [group] = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
    expect(group.summary).toBe("A brand-new kind of diagnostic this UI does not know about yet.");
    expect(group.title).toBe("Some Future Code");
  });

  it("surfaces a suggested action only when the driver provided one", () => {
    const withAction: PerformanceTuningDiagnostic[] = [
      {
        code: "TABLE_MAPPING_FAILED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "executionPlan",
        message: "unresolved",
        node: { id: "n0", operation: "Scan" },
        suggestedAction: "Try again with targetTables set.",
      },
    ];
    const withoutAction: PerformanceTuningDiagnostic[] = [
      {
        code: "TABLE_MAPPING_FAILED",
        severity: "warning",
        affectsCompleteness: true,
        scope: "executionPlan",
        message: "unresolved",
        node: { id: "n1", operation: "Scan" },
      },
    ];

    expect(buildPerformanceTuningDiagnosticGroups(withAction, [])[0].suggestedAction).toBe(
      "Try again with targetTables set.",
    );
    expect(buildPerformanceTuningDiagnosticGroups(withoutAction, [])[0].suggestedAction).toBeUndefined();
  });

  describe("unavailableSections", () => {
    it("turns an unavailableSections-only result into a visible warning group (never silently empty)", () => {
      const unavailableSections: UnavailableSection[] = [
        {
          section: "tableDefinition",
          schemaName: "public",
          tableName: "orders",
          reason: "permission denied for relation orders",
        },
      ];

      const groups = buildPerformanceTuningDiagnosticGroups([], unavailableSections);
      expect(groups).toHaveLength(1);
      expect(groups[0].severity).toBe("warning");
      expect(groups[0].summary.length).toBeGreaterThan(0);
      expect(groups[0].summary).toContain("public.orders");
      expect(groups[0].details[0].technicalMessage).toBe("permission denied for relation orders");
    });

    it("surfaces requiredPermissions as a suggested action", () => {
      const unavailableSections: UnavailableSection[] = [
        {
          section: "columnStatistics",
          schemaName: "public",
          tableName: "orders",
          reason: "permission denied for view pg_stats",
          requiredPermissions: ["SELECT ON pg_stats"],
        },
      ];

      const [group] = buildPerformanceTuningDiagnosticGroups([], unavailableSections);
      expect(group.suggestedAction).toContain("SELECT ON pg_stats");
    });

    it("groups unavailableSections per section+table, mirroring diagnostic grouping", () => {
      const unavailableSections: UnavailableSection[] = [
        { section: "columnStatistics", tableName: "orders", reason: "r1" },
        { section: "physicalHealth", tableName: "orders", reason: "r2" },
        { section: "columnStatistics", tableName: "customers", reason: "r3" },
      ];

      const groups = buildPerformanceTuningDiagnosticGroups([], unavailableSections);
      expect(groups).toHaveLength(3);
    });

    it("combines diagnostics and unavailableSections in one list, information first", () => {
      const groups = buildPerformanceTuningDiagnosticGroups(n3n4Diagnostics, [
        { section: "tableDefinition", tableName: "orders", reason: "not found" },
      ]);

      expect(groups).toHaveLength(2);
      expect(groups[0].severity).toBe("info");
      expect(groups[1].severity).toBe("warning");
    });
  });

  it("returns an empty array for a fully clean, empty result", () => {
    expect(buildPerformanceTuningDiagnosticGroups([], [])).toEqual([]);
  });

  describe("vendor-representative fixtures (§9.3)", () => {
    it("groups MySQL's repeated filesort/temp-table flag text across nodes", () => {
      const diagnostics: PerformanceTuningDiagnostic[] = [
        {
          code: "PLAN_OBSERVATION",
          severity: "info",
          affectsCompleteness: false,
          scope: "executionPlan",
          message: "Uses filesort.",
          node: { id: "n2", operation: "Group By" },
        },
        {
          code: "PLAN_OBSERVATION",
          severity: "info",
          affectsCompleteness: false,
          scope: "executionPlan",
          message: "Uses filesort.",
          node: { id: "n5", operation: "Order By" },
        },
      ];

      const [group] = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
      expect(group.severity).toBe("info");
      expect(group.details).toHaveLength(2);
    });

    it("keeps SQL Server's per-node native 'NO STATS' text as its own group instead of merging unrelated nodes", () => {
      const diagnostics: PerformanceTuningDiagnostic[] = [
        {
          code: "PLAN_OBSERVATION",
          severity: "info",
          affectsCompleteness: false,
          scope: "executionPlan",
          message: "NO STATS: ([testdb].[perf].[heap_table].[a])",
          node: { id: "n2", operation: "Table Scan" },
        },
        {
          code: "PLAN_OBSERVATION",
          severity: "info",
          affectsCompleteness: false,
          scope: "executionPlan",
          message: "NO STATS: ([testdb].[perf].[heap_table].[b])",
          node: { id: "n4", operation: "Table Scan" },
        },
      ];

      const groups = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
      expect(groups).toHaveLength(2);
      expect(groups.every((g) => g.severity === "info")).toBe(true);
    });

    it("distinguishes a per-table COLLECTION_TRUNCATED (columns/indexes cut) from a collection-wide one (payload/table-list)", () => {
      const diagnostics: PerformanceTuningDiagnostic[] = [
        {
          code: "COLLECTION_TRUNCATED",
          severity: "warning",
          affectsCompleteness: true,
          scope: "tableDefinition",
          message: "Columns truncated to 40 of 87.",
          schemaName: "public",
          tableName: "orders",
          section: "tableDefinition",
        },
        {
          code: "COLLECTION_TRUNCATED",
          severity: "warning",
          affectsCompleteness: true,
          scope: "collection",
          message: "Result was truncated to satisfy maxPayloadBytes.",
        },
      ];

      const groups = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
      expect(groups).toHaveLength(2);
      const [perTable, collectionWide] = groups;
      expect(perTable.summary).toContain("public.orders");
      expect(collectionWide.summary).not.toContain("public.orders");
    });

    it("reports DATABASE_VERSION_UNAVAILABLE with a clear, self-contained summary", () => {
      const diagnostics: PerformanceTuningDiagnostic[] = [
        {
          code: "DATABASE_VERSION_UNAVAILABLE",
          severity: "warning",
          affectsCompleteness: true,
          scope: "collection",
          message: "Failed to retrieve the database version.",
        },
      ];

      const [group] = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
      expect(group.severity).toBe("warning");
      expect(group.title).toContain("version");
      expect(group.summary.length).toBeGreaterThan(0);
    });

    it("classifies Oracle's index-only-access-unresolved TABLE_MAPPING_FAILED with owner as technical detail", () => {
      const diagnostics: PerformanceTuningDiagnostic[] = [
        {
          code: "TABLE_MAPPING_FAILED",
          severity: "warning",
          affectsCompleteness: true,
          scope: "executionPlan",
          message: "Could not resolve a table for plan node n2 (index IDX_PERF_ORDERS_STATUS, owner TESTUSER).",
          node: { id: "n2", operation: "INDEX RANGE SCAN", objectKind: "index", objectName: "IDX_PERF_ORDERS_STATUS" },
          schemaName: "TESTUSER",
        },
      ];

      const [group] = buildPerformanceTuningDiagnosticGroups(diagnostics, []);
      expect(group.severity).toBe("warning");
      expect(group.details[0]).toEqual(
        expect.objectContaining({ nodeId: "n2", objectName: "IDX_PERF_ORDERS_STATUS", schemaName: "TESTUSER" }),
      );
    });
  });
});
