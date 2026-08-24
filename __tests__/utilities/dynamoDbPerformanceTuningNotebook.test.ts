import type { DynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { NotebookCellKind, Uri, window, workspace } from "vscode";
import type { PerformanceTuningAiAnalysisResult } from "../../src/shared/PerformanceTuningAiAnalysis";
import {
  buildDynamoDbAiAnalysisNotebookCells,
  saveDynamoDbAiAnalysisAsNotebook,
} from "../../src/utilities/dynamoDbPerformanceTuningNotebook";

// Same cast-through-unknown workaround as performanceTuningAiNotebook.test.ts.
type MockWorkspaceFolders = { uri: Uri; name?: string; index?: number }[] | undefined;
const setWorkspaceFolders = (folders: MockWorkspaceFolders): void => {
  (workspace as unknown as { workspaceFolders: MockWorkspaceFolders }).workspaceFolders = folders;
};

function buildContext(overrides: Partial<DynamoDbPerformanceTuningContext> = {}): DynamoDbPerformanceTuningContext {
  return {
    formatVersion: 1,
    engine: "dynamodb",
    service: { provider: "AWS", service: "DynamoDB", region: "ap-northeast-1", endpointKind: "aws", tableName: "orders" },
    statement: {
      language: "partiql",
      text: "SELECT * FROM orders WHERE pk = 'tenant#42'",
      source: "sqlHistory",
      kind: "select",
      observationEligibility: { allowed: true },
    },
    accessPattern: {
      operation: "PartiQLSelect",
      accessPath: "tableQuery",
      confidence: "certain",
      tableName: "orders",
      partitionKey: { attributeName: "pk", operator: "=", conditionPresent: true },
      postReadFilter: { present: false, attributes: [] },
      projection: { allAttributes: true, attributes: [] },
      consistentRead: "eventual",
    },
    table: {
      tableName: "orders",
      billingMode: "PAY_PER_REQUEST",
      keySchema: { partitionKey: { attributeName: "pk", attributeType: "S" } },
      attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
      localSecondaryIndexes: [],
      globalSecondaryIndexes: [],
      contributorInsights: [],
    },
    collection: {
      collectedAt: "2026-08-24T00:00:00.000Z",
      status: "complete",
      diagnostics: [],
      unavailableSections: [],
    },
    ...overrides,
  };
}

function buildAnalysis(
  overrides: Partial<PerformanceTuningAiAnalysisResult> = {},
): PerformanceTuningAiAnalysisResult {
  return {
    formatVersion: 1,
    summary: "This statement performs a full table scan.",
    findings: [
      {
        title: "Full table scan",
        detail: "No partition key condition was found.",
        severity: "warning",
        evidence: { tableName: "orders", contextPath: "/accessPattern" },
      },
    ],
    recommendations: [],
    confidence: "medium",
    missingContext: [],
    model: { id: "gpt-4o", vendor: "copilot", family: "gpt-4o", version: "1" },
    generatedAt: "2026-08-24T00:05:00.000Z",
    ...overrides,
  };
}

type BuiltCell = ReturnType<typeof buildDynamoDbAiAnalysisNotebookCells>[number];

function findCell(cells: BuiltCell[], text: string): BuiltCell {
  const cell = cells.find((candidate) => candidate.value.includes(text));
  expect(cell, `Expected a notebook cell containing ${text}`).toBeDefined();
  return cell!;
}

function findJsonCell(cells: BuiltCell[], label: string): BuiltCell {
  const cell = cells.find((candidate) => candidate.metadata?.cellLabel === label);
  expect(cell, `Expected the ${label} JSON cell`).toBeDefined();
  return cell!;
}

describe("buildDynamoDbAiAnalysisNotebookCells", () => {
  it("builds overview/query-flow, snapshot, access pattern, table definition, observed request, CloudWatch, analysis, and the three reproducibility JSON cells (no collection issues/information/raw metrics for the default fixture)", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(buildContext(), buildAnalysis());

    expect(cells).toHaveLength(11);
    expect(cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(cells[0].value).toContain("SELECT * FROM orders WHERE pk = 'tenant#42'");
    expect(cells[0].value).toContain("## Query flow");
    expect(cells[0].value).toContain("```mermaid");
    expect(cells[0].value).toContain("Partition/Sort key condition");

    expect(cells[1].value).toContain("## Performance snapshot");
    expect(cells[2].value).toContain("## Access pattern");
    expect(cells[3].value).toContain("## Table and index definition");
    expect(cells[4].value).toContain("## Observed request");
    expect(cells[4].value).toContain("No read has been observed for this exact statement yet.");
    expect(cells[5].value).toContain("## CloudWatch metrics");
    expect(cells[5].value).toContain("CloudWatch metrics were not collected.");

    expect(cells[6].value).toContain("### Findings");
    expect(cells[6].value).toContain("Full table scan");

    expect(cells[7].value).toContain("Full context JSON");
    expect(cells[7].value).toContain("AI request messages");
    expect(cells[7].value).toContain("AI analysis JSON");

    expect(cells[8].kind).toBe(NotebookCellKind.Code);
    expect(cells[8].metadata).toEqual({ cellLabel: "Full context JSON" });
    expect(JSON.parse(cells[8].value)).toMatchObject({ service: { tableName: "orders" } });
  });

  it("shows a native-Query summary instead of a SQL fence when statement.text is absent", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext({
        statement: {
          language: "dynamodb-query",
          source: "dynamoQueryPanel",
          kind: "query",
          observationEligibility: { allowed: true },
        },
        service: { provider: "AWS", service: "DynamoDB", endpointKind: "aws", tableName: "orders", indexName: "iCountry" },
      }),
      buildAnalysis(),
    );
    expect(cells[0].value).not.toContain("```sql");
    expect(cells[0].value).toContain("Native Query on orders (index iCountry)");
  });

  it("places Collection issues before Access pattern, and Information right before the AI analysis", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext({
        collection: {
          collectedAt: "2026-08-24T00:00:00.000Z",
          status: "partial",
          diagnostics: [
            {
              code: "DYNAMODB_APPROXIMATE_TABLE_METADATA",
              severity: "info",
              affectsCompleteness: false,
              scope: "tableDefinition",
              message: "ItemCount/TableSizeBytes are approximations.",
              tableName: "orders",
            },
          ],
          unavailableSections: [
            { section: "cloudWatchMetrics", tableName: "orders", reason: "AccessDenied" },
          ],
        },
      }),
      buildAnalysis(),
    );
    const values = cells.map((c) => c.value);
    const overviewIndex = values.findIndex((v) => v.includes("# DynamoDB Performance Tuning AI Analysis"));
    const issuesIndex = values.findIndex((v) => v.includes("## Collection issues"));
    const accessPatternIndex = values.findIndex((v) => v.includes("## Access pattern"));
    const informationIndex = values.findIndex((v) => v.includes("## Information"));
    const analysisIndex = values.findIndex((v) => v.includes("### Findings"));

    expect(issuesIndex).toBeGreaterThan(overviewIndex);
    expect(accessPatternIndex).toBeGreaterThan(issuesIndex);
    expect(informationIndex).toBeGreaterThan(accessPatternIndex);
    expect(analysisIndex).toBeGreaterThan(informationIndex);
    expect(values[issuesIndex]).toContain("CloudWatch metrics unavailable");
    expect(values[informationIndex]).toContain("Table metadata is approximate");
  });

  it("renders observed-read evidence and its bounded caveat when present", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext({
        observation: {
          source: "observedRead",
          returnedItemCount: 3,
          requestCount: 1,
          retryCount: 0,
          consumedCapacity: { capacityUnits: 1.5, readCapacityUnits: 1.5 },
          bounded: true,
          boundDescription: "Limited to a single API response by Run Observed Read.",
        },
      }),
      buildAnalysis(),
    );
    const observedCell = findCell(cells, "## Observed request");
    expect(observedCell.value).toContain("| Returned items | 3 |");
    expect(observedCell.value).toContain("1.5 total");
    expect(observedCell.value).toContain("Limited to a single API response");
  });

  it("adds an 'Appendix: Raw metrics' cell only when CloudWatch series were actually collected", () => {
    const withoutSeries = buildDynamoDbAiAnalysisNotebookCells(buildContext(), buildAnalysis());
    expect(withoutSeries.some((c) => c.value.includes("## Appendix: Raw metrics"))).toBe(false);

    const withSeries = buildDynamoDbAiAnalysisNotebookCells(
      buildContext({
        cloudWatch: {
          window: { startTime: "t0", endTime: "t1", periodSeconds: 60 },
          series: [
            {
              metricName: "ConsumedReadCapacityUnits",
              statistic: "Sum",
              scope: "table",
              timestamps: ["t0", "t1"],
              values: [1, 2],
              noData: false,
              source: "AWS/DynamoDB",
            },
          ],
        },
      }),
      buildAnalysis(),
    );
    const appendixCell = findCell(withSeries, "## Appendix: Raw metrics");
    expect(appendixCell.value).toContain("ConsumedReadCapacityUnits");
    expect(appendixCell.value).toContain("| t0 | 1 |");
    expect(appendixCell.value).toContain("| t1 | 2 |");

    const cloudWatchCell = findCell(withSeries, "## CloudWatch metrics");
    expect(cloudWatchCell.value).toContain("| ConsumedReadCapacityUnits |");
  });

  it("rebuilds the AI request messages using the DynamoDB prompt builder, with the language option from the original analysis", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext(),
      buildAnalysis({
        request: { promptFormatVersion: 1, translateResponse: true, language: "ja", contextDetail: "full" },
      }),
    );
    const request = JSON.parse(findJsonCell(cells, "AI request messages").value);
    expect(request.messages[0].content).toContain("following language: ja");
    expect(request.messages[1].content).toContain("SELECT * FROM orders WHERE pk = 'tenant#42'");
  });
});

describe("saveDynamoDbAiAnalysisAsNotebook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWorkspaceFolders([{ uri: Uri.file("/workspace") }]);
    (workspace.openNotebookDocument as Mock).mockResolvedValue({
      uri: Uri.file("/workspace/reports/performance-tuning/whatever.dbn"),
    });
  });

  it("returns ok:false and writes nothing when no workspace folder is open", async () => {
    setWorkspaceFolders(undefined);

    const result = await saveDynamoDbAiAnalysisAsNotebook(buildContext(), buildAnalysis());

    expect(result.ok).toBe(false);
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses to save (without writing anything) when the context fails validation", async () => {
    // A forbidden key (ExpressionAttributeValues, per db-drivers'
    // dynamoDbPerformanceTuningContextValidator.ts) nested anywhere in the
    // context - simulates a hypothetical upstream bug leaking real values
    // in, which this save path's own last-line validator call must catch.
    const leaking = buildContext() as unknown as Record<string, unknown>;
    leaking.leaked = { ExpressionAttributeValues: { ":pk": { S: "tenant#42" } } };

    const result = await saveDynamoDbAiAnalysisAsNotebook(
      leaking as unknown as DynamoDbPerformanceTuningContext,
      buildAnalysis(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("validation");
    }
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("creates the reports/performance-tuning directory and writes the notebook there, named after the table", async () => {
    const result = await saveDynamoDbAiAnalysisAsNotebook(buildContext(), buildAnalysis());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.relativePath.replace(/\\/g, "/")).toMatch(
      /^reports\/performance-tuning\/perf-tuning-analysis-orders-\d{8}-\d{6}\.dbn$/,
    );

    expect(workspace.fs.createDirectory).toHaveBeenCalledTimes(1);
    const [dirUri] = (workspace.fs.createDirectory as Mock).mock.calls[0];
    expect((dirUri as Uri).fsPath.replace(/\\/g, "/")).toBe("/workspace/reports/performance-tuning");

    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    expect(workspace.openNotebookDocument).toHaveBeenCalledTimes(1);
    expect(window.showNotebookDocument).toHaveBeenCalledWith(expect.anything(), { viewColumn: 2 });
  });

  it("picks a different filename when the timestamped path already exists", async () => {
    (workspace.fs.stat as Mock).mockResolvedValueOnce({} as never);

    const result = await saveDynamoDbAiAnalysisAsNotebook(buildContext(), buildAnalysis());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.relativePath.replace(/\\/g, "/")).toMatch(
      /^reports\/performance-tuning\/perf-tuning-analysis-orders-\d{8}-\d{6}-\d+\.dbn$/,
    );
  });
});
