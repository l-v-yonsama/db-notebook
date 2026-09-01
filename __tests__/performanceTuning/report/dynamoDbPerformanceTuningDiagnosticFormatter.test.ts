import type {
  DynamoDbPerformanceTuningDiagnostic,
  DynamoDbUnavailableSection,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import { buildDynamoDbPerformanceTuningDiagnosticGroups } from "../../../src/performanceTuning/report/dynamoDbPerformanceTuningDiagnosticFormatter";

function diag(overrides: Partial<DynamoDbPerformanceTuningDiagnostic> = {}): DynamoDbPerformanceTuningDiagnostic {
  return {
    code: "DYNAMODB_FULL_TABLE_SCAN",
    severity: "warning",
    affectsCompleteness: false,
    scope: "accessPattern",
    message: "This statement performs a full table scan.",
    tableName: "orders",
    ...overrides,
  };
}

describe("buildDynamoDbPerformanceTuningDiagnosticGroups", () => {
  it("groups a full table scan diagnostic into a warning card with a detail row", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups([diag()], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      severity: "warning",
      title: "Full table scan",
      summary: expect.stringContaining("every item in the table"),
    });
    expect(groups[0].details).toEqual([{ tableName: "orders", objectName: undefined, technicalMessage: diag().message }]);
  });

  it("keeps two DYNAMODB_SECTION_COLLECTION_FAILED diagnostics with different scopes as separate groups", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [
        diag({
          code: "DYNAMODB_SECTION_COLLECTION_FAILED",
          scope: "tableDefinition",
          message: "Time to live status could not be collected.",
        }),
        diag({
          code: "DYNAMODB_SECTION_COLLECTION_FAILED",
          scope: "contributorInsights",
          indexName: "iCountry",
          message: "Contributor Insights status could not be collected.",
        }),
      ],
      [],
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.title).sort()).toEqual([
      "Contributor Insights could not be fully collected",
      "Table definition could not be fully collected",
    ]);
  });

  it("merges multiple DYNAMODB_CLOUDWATCH_NO_DATA diagnostics into one group listing every metric name", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [
        diag({ code: "DYNAMODB_CLOUDWATCH_NO_DATA", severity: "info", scope: "cloudWatchMetrics", metricName: "ConsumedReadCapacityUnits", message: "no data" }),
        diag({ code: "DYNAMODB_CLOUDWATCH_NO_DATA", severity: "info", scope: "cloudWatchMetrics", metricName: "ReadThrottleEvents", message: "no data" }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Some CloudWatch metrics have no datapoints");
    expect(groups[0].summary).toContain("ConsumedReadCapacityUnits");
    expect(groups[0].summary).toContain("ReadThrottleEvents");
    expect(groups[0].details).toHaveLength(2);
  });

  it("explains that missing throttle and error datapoints are common when no events are reported", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [
        diag({ code: "DYNAMODB_CLOUDWATCH_NO_DATA", severity: "info", scope: "cloudWatchMetrics", metricName: "ReadThrottleEvents", message: "no data" }),
        diag({ code: "DYNAMODB_CLOUDWATCH_NO_DATA", severity: "info", scope: "cloudWatchMetrics", metricName: "ThrottledRequests", message: "no data" }),
        diag({ code: "DYNAMODB_CLOUDWATCH_NO_DATA", severity: "info", scope: "cloudWatchMetrics", metricName: "SystemErrors", message: "no data" }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      severity: "info",
      title: "No throttle or error datapoints",
      summary: expect.stringContaining("common when no such events are reported"),
    });
    expect(groups[0].summary).toContain("not treated as a confirmed zero");
    expect(groups[0].details).toHaveLength(3);
  });

  it("keeps table and GSI no-data details distinguishable by index name", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [
        diag({ code: "DYNAMODB_CLOUDWATCH_NO_DATA", severity: "info", scope: "cloudWatchMetrics", metricName: "ReadThrottleEvents", message: "table no data" }),
        diag({ code: "DYNAMODB_CLOUDWATCH_NO_DATA", severity: "info", scope: "cloudWatchMetrics", indexName: "tenant-status-gsi", metricName: "ReadThrottleEvents", message: "gsi no data" }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].details).toEqual([
      expect.objectContaining({ objectName: undefined, technicalMessage: "table no data" }),
      expect.objectContaining({ objectName: "tenant-status-gsi", technicalMessage: "gsi no data" }),
    ]);
  });

  it("renders intentionally skipped monitoring as information rather than a collection warning", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [
        diag({
          code: "DYNAMODB_MONITORING_COLLECTION_SKIPPED",
          severity: "info",
          affectsCompleteness: false,
          scope: "collection",
          message: "CloudWatch metrics and Contributor Insights are outside the scope of local/custom DynamoDB endpoints.",
        }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      severity: "info",
      title: "CloudWatch monitoring not collected",
      summary: expect.stringContaining("outside the scope"),
    });
    expect(groups[0].suggestedAction).toBeUndefined();
  });

  it("distinguishes index-list truncation from payload truncation by scope", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [
        diag({ code: "DYNAMODB_COLLECTION_TRUNCATED", scope: "tableDefinition", message: "Index list truncated to 20 entries." }),
        diag({ code: "DYNAMODB_COLLECTION_TRUNCATED", scope: "collection", tableName: undefined, message: "The context was reduced to fit the payload limit." }),
      ],
      [],
    );
    expect(groups).toHaveLength(2);
    const byTitle = Object.fromEntries(groups.map((g) => [g.title, g]));
    expect(byTitle["Index list shortened to stay within limits"]).toBeDefined();
    expect(byTitle["Result shortened to stay within limits"]).toBeDefined();
  });

  it("falls back to a humanized title and the raw message for an unrecognized code", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [diag({ code: "DYNAMODB_SOME_FUTURE_CODE" as DynamoDbPerformanceTuningDiagnostic["code"], message: "a brand new diagnostic" })],
      [],
    );
    expect(groups[0].title).toBe("Dynamodb Some Future Code");
    expect(groups[0].summary).toBe("a brand new diagnostic");
  });

  it("never sets suggestedAction from a diagnostic (DynamoDbPerformanceTuningDiagnostic has no such field)", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups([diag()], []);
    expect(groups[0].suggestedAction).toBeUndefined();
  });

  it("builds an unavailable-section group with a permissions-based suggested action and an index in the detail row", () => {
    const sections: DynamoDbUnavailableSection[] = [
      {
        section: "cloudWatchMetrics",
        tableName: "orders",
        indexName: "iCountry",
        reason: "AccessDenied",
        requiredPermissions: ["cloudwatch:GetMetricData"],
      },
    ];
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups([], sections);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      severity: "warning",
      title: "CloudWatch metrics unavailable",
      summary: expect.stringContaining("orders (iCountry)"),
      suggestedAction: "Ask your AWS administrator to grant: cloudwatch:GetMetricData.",
    });
    expect(groups[0].details).toEqual([{ tableName: "orders", objectName: "iCountry", technicalMessage: "AccessDenied" }]);
  });

  it("orders info-severity groups before warning-severity ones", () => {
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      [
        diag({ code: "DYNAMODB_FULL_TABLE_SCAN", severity: "warning" }),
        diag({ code: "DYNAMODB_APPROXIMATE_TABLE_METADATA", severity: "info", message: "approximate" }),
      ],
      [],
    );
    expect(groups.map((g) => g.severity)).toEqual(["info", "warning"]);
  });

  it("never drops an input diagnostic or unavailable section", () => {
    const diagnostics = [diag({ code: "DYNAMODB_FULL_TABLE_SCAN" }), diag({ code: "DYNAMODB_POST_READ_FILTER", severity: "info" })];
    const sections: DynamoDbUnavailableSection[] = [{ section: "observation", reason: "not observed yet" }];
    const groups = buildDynamoDbPerformanceTuningDiagnosticGroups(diagnostics, sections);
    const totalDetails = groups.reduce((n, g) => n + g.details.length, 0);
    expect(totalDetails).toBe(diagnostics.length + sections.length);
  });
});
