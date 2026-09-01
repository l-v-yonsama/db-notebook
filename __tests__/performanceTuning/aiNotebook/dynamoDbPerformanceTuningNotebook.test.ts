import type { DynamoDbPerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { NotebookCellKind, Uri, window, workspace } from "vscode";
import type { PerformanceTuningAiAnalysisResult } from "../../../src/shared/PerformanceTuningAiAnalysis";
import {
  buildDynamoDbAiAnalysisNotebookCells,
  saveDynamoDbAiAnalysisAsNotebook,
} from "../../../src/performanceTuning/aiNotebook/dynamoDbPerformanceTuningNotebook";

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
      projection: { mode: "allAttributes", allAttributes: true, attributes: [] },
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

const writtenNotebook = (): { cells: Array<{ value: string; metadata?: { cellLabel?: string } }> } => {
  const [, bytes] = (workspace.fs.writeFile as Mock).mock.calls[0];
  return JSON.parse(Buffer.from(bytes as Uint8Array).toString("utf8"));
};

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
  it("builds a numbered, TOC-first report with summary chapter 4, detailed evidence, appendices, and JSON cells", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(buildContext(), { analysis: buildAnalysis() });

    expect(cells).toHaveLength(16);
    expect(cells[0].kind).toBe(NotebookCellKind.Markup);
    expect(cells[0].metadata).toEqual({ excludeFromHtml: true });
    expect(cells[0].value).toContain("## Table of contents");
    expect(cells[0].value).toContain("[4. Summary and recommendations](#4-summary-and-recommendations)");
    expect(cells[1].value).toContain("## 1. Overview");
    expect(cells[1].value).toContain("2026-08-24T00:00:00.000Z (local ");
    expect(cells[1].value).toContain("2026-08-24T00:05:00.000Z (local ");
    expect(cells[2].value).toContain("## 2. Target request");
    expect(cells[2].value).toContain("SELECT * FROM orders WHERE pk = 'tenant#42'");
    expect(cells[3].value).toContain("## 3. Collection status");

    expect(cells[4].value).toContain("## 4. Summary and recommendations");
    expect(cells[4].value).toContain("### 4.1. Performance snapshot");
    expect(cells[4].value).toContain("### 4.2. AI summary");
    expect(cells[5].value).toContain("## 5. Query flow");
    expect(cells[5].value).toContain("```mermaid");
    expect(cells[5].value).toContain('Request["Step 1: Request<br/>PartiQL SELECT"]');
    expect(cells[5].value).toContain('Result["Step 5: Result');
    expect(cells[5].value).not.toMatch(/\["\d+\.\s/);
    expect(cells[5].value).toContain("PK pk =");
    expect(cells[5].value).toContain("Evaluation not measured");
    expect(cells[6].value).toContain("## 6. Access pattern");
    expect(cells[7].value).toContain("## 7. Observed measurements");
    expect(cells[7].value).toContain("No read has been observed for this exact statement yet.");
    expect(cells[8].value).toContain("## 8. Table and index information");
    expect(cells[9].value).toContain("## 9. CloudWatch metrics");
    expect(cells[9].value).toContain("CloudWatch metrics were not collected.");
    expect(cells[10].value).toContain("## 10. Additional information");
    expect(cells[11].value).toContain("## Appendix A. Raw CloudWatch metrics");

    expect(cells[4].value).toContain("### 4.3. Findings");
    expect(cells[4].value).toContain("Full table scan");

    expect(cells[12].value).toContain("## Appendix B. Raw data");
    expect(cells[12].value).toContain("Full context JSON");

    expect(cells[13].kind).toBe(NotebookCellKind.Code);
    expect(cells[13].metadata).toEqual({ cellLabel: "Full context JSON" });
    expect(JSON.parse(cells[13].value)).toMatchObject({ service: { tableName: "orders" } });
  });

  it("shows a native-Query summary instead of a SQL fence when statement.text is absent", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext({
        statement: {
          language: "dynamodb-query",
          source: "sqlHistory",
          kind: "query",
          observationEligibility: { allowed: true },
        },
        service: { provider: "AWS", service: "DynamoDB", endpointKind: "aws", tableName: "orders", indexName: "iCountry" },
      }),
      { analysis: buildAnalysis() },
    );
    expect(cells[2].value).not.toContain("```sql");
    expect(cells[2].value).toContain("Native Query on orders (index iCountry)");
  });

  it("places collection status before chapter 4 and additional information after the evidence chapters", () => {
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
      { analysis: buildAnalysis() },
    );
    const values = cells.map((c) => c.value);
    const overviewIndex = values.findIndex((v) => v.includes("## 1. Overview"));
    const issuesIndex = values.findIndex((v) => v.includes("## 3. Collection status"));
    const summaryIndex = values.findIndex((v) => v.includes("## 4. Summary and recommendations"));
    const accessPatternIndex = values.findIndex((v) => v.includes("## 6. Access pattern"));
    const informationIndex = values.findIndex((v) => v.includes("## 10. Additional information"));

    expect(issuesIndex).toBeGreaterThan(overviewIndex);
    expect(summaryIndex).toBeGreaterThan(issuesIndex);
    expect(accessPatternIndex).toBeGreaterThan(summaryIndex);
    expect(informationIndex).toBeGreaterThan(accessPatternIndex);
    expect(values[issuesIndex]).toContain("CloudWatch metrics unavailable");
    expect(values[informationIndex]).toContain("Table metadata is approximate");
  });

  it("renders observed-read evidence and its bounded caveat when present", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext({
        observation: {
          source: "observedRead",
          observedAt: "2026-08-24T00:01:00.000Z",
          returnedItemCount: 3,
          requestCount: 1,
          retryCount: 0,
          consumedCapacity: { capacityUnits: 1.5, readCapacityUnits: 1.5 },
          bounded: true,
          boundDescription: "Limited to a single API response by Run Observed Read.",
        },
      }),
      { analysis: buildAnalysis() },
    );
    const observedCell = findCell(cells, "## 7. Observed measurements");
    expect(observedCell.value).toContain("| Returned items | 3 |");
    expect(observedCell.value).toContain("2026-08-24T00:01:00.000Z (local ");
    expect(observedCell.value).toContain("1.5 total");
    expect(observedCell.value).toContain("Limited to a single API response");
    const flowCell = findCell(cells, "## 5. Query flow");
    expect(flowCell.value).toContain("Evaluated count unavailable in PartiQL");
    expect(flowCell.value).toContain("3 returned");
    expect(flowCell.value).toContain("Consumed Capacity: 1.5 total / 1.5 read CU");
  });

  it("renders a native Query funnel with approximate table size and same-observation evaluated/returned metrics", () => {
    const base = buildContext();
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext({
        statement: {
          ...base.statement,
          language: "dynamodb-query",
          text: undefined,
          source: "sqlHistory",
          kind: "query",
        },
        accessPattern: {
          ...base.accessPattern,
          operation: "Query",
          postReadFilter: { present: true, attributes: ["status"] },
        },
        table: {
          ...base.table,
          itemCount: { value: 3000, estimated: true, source: "DescribeTable.ItemCount" },
        },
        observation: {
          source: "observedRead",
          returnedItemCount: 25,
          evaluatedItemCount: 100,
          filterPassRate: 0.25,
          consumedCapacity: { capacityUnits: 1.5, readCapacityUnits: 1.5 },
          clientElapsedTimeMs: 42,
          bounded: true,
        },
      }),
      { analysis: buildAnalysis() },
    );

    const flow = findCell(cells, "## 5. Query flow").value;
    expect(flow).toContain("Approx. 3,000 items (AWS estimate)");
    expect(flow).toContain("100 evaluated");
    expect(flow).toContain("25 returned (25.00% pass)");
    expect(flow).toContain("Client time: 42 ms");
    expect(flow).toContain("Single bounded response");
  });

  it("keeps Appendix A stable and fills it with raw datapoints when CloudWatch series exist", () => {
    const withoutSeries = buildDynamoDbAiAnalysisNotebookCells(buildContext(), { analysis: buildAnalysis() });
    expect(findCell(withoutSeries, "## Appendix A. Raw CloudWatch metrics").value).toContain(
      "No raw CloudWatch datapoints were collected",
    );

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
      { analysis: buildAnalysis() },
    );
    const appendixCell = findCell(withSeries, "## Appendix A. Raw CloudWatch metrics");
    expect(appendixCell.value).toContain("ConsumedReadCapacityUnits");
    expect(appendixCell.value).toContain("| t0 | 1 |");
    expect(appendixCell.value).toContain("| t1 | 2 |");

    const cloudWatchCell = findCell(withSeries, "## 9. CloudWatch metrics");
    expect(cloudWatchCell.value).toContain("| ConsumedReadCapacityUnits |");
  });

  it("rebuilds the AI request messages using the DynamoDB prompt builder, with the language option from the original analysis", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(
      buildContext(),
      { analysis: buildAnalysis({
        request: { promptFormatVersion: 1, translateResponse: true, language: "ja", contextDetail: "full" },
      }) },
    );
    const request = JSON.parse(findJsonCell(cells, "AI request messages").value);
    expect(request.messages[0].content).toContain("following language: ja");
    expect(request.messages[1].content).toContain("SELECT * FROM orders WHERE pk = 'tenant#42'");
  });

  it("records the estimated model token usage in the overview and request metadata", () => {
    const analysis = buildAnalysis({
      request: {
        promptFormatVersion: 1,
        translateResponse: false,
        language: "en",
        contextDetail: "full",
        tokenUsage: { inputTokens: 12_345, maxInputTokens: 32_000, safetyMargin: 128 },
      },
    });
    const cells = buildDynamoDbAiAnalysisNotebookCells(buildContext(), { analysis });

    expect(cells[1].value).toContain("| Estimated AI input | 12,345 / 32,000 tokens (38.6%) |");
    expect(cells[1].value).toContain("| Token safety margin | 128 tokens |");
    expect(JSON.parse(findJsonCell(cells, "AI request messages").value)).toMatchObject({
      tokenUsage: { inputTokens: 12_345, maxInputTokens: 32_000, safetyMargin: 128 },
    });
  });

  it("labels a context-only notebook as an evidence report", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(buildContext(), {});

    expect(cells[0].value).toContain("DynamoDB Performance Tuning Evidence Report");
    expect(cells.some((cell) => cell.metadata?.cellLabel === "AI analysis JSON")).toBe(false);
  });

  it("includes run-level Benchmark evidence even without a baseline comparison", () => {
    const cells = buildDynamoDbAiAnalysisNotebookCells(buildContext({
      benchmark: {
        startedAt: "2026-08-27T18:30:00.000Z",
        completedAt: "2026-08-27T18:30:01.000Z",
        requestedRuns: 3,
        completedRuns: 3,
        samples: [
          { run: 1, clientElapsedTimeMs: 10, returnedItemCount: 2, evaluatedItemCount: 20, completeness: "bounded" },
          { run: 2, clientElapsedTimeMs: 20, returnedItemCount: 2, evaluatedItemCount: 20, completeness: "bounded" },
          { run: 3, clientElapsedTimeMs: 30, returnedItemCount: 2, evaluatedItemCount: 20, completeness: "bounded" },
        ],
        medianClientElapsedTimeMs: 20,
        averageClientElapsedTimeMs: 20,
        minClientElapsedTimeMs: 10,
        maxClientElapsedTimeMs: 30,
        source: "performanceTuningBenchmark",
      },
    }), {});
    const chapter = findCell(cells, "Benchmark measurements").value;

    expect(chapter).toContain("| Runs | 3 / 3 completed |");
    expect(chapter).toContain("| 2 | 20 ms | 2 / 20 | - |");
    expect(chapter).toContain("2026-08-27T18:30:00.000Z (local ");
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

  it("saves deterministic context as an evidence report without AI or a baseline", async () => {
    const result = await saveDynamoDbAiAnalysisAsNotebook(buildContext(), {});

    expect(result.ok).toBe(true);
    expect(result.ok && result.relativePath).toMatch(
      /^reports\/performance-tuning\/perf-tuning-evidence-orders-\d{8}-\d{6}\.dbn$/
    );
    expect(workspace.fs.writeFile).toHaveBeenCalledOnce();
  });

  it("returns ok:false and writes nothing when no workspace folder is open", async () => {
    setWorkspaceFolders(undefined);

    const result = await saveDynamoDbAiAnalysisAsNotebook(buildContext(), { analysis: buildAnalysis() });

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
      { analysis: buildAnalysis() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("validation");
    }
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("creates the reports/performance-tuning directory and writes the notebook there, named after the table", async () => {
    const result = await saveDynamoDbAiAnalysisAsNotebook(buildContext(), { analysis: buildAnalysis() });

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
    const written = writtenNotebook();
    expect(written.cells.some((cell) => cell.metadata?.cellLabel === "AI analysis JSON")).toBe(true);
    expect(written.cells.some((cell) => cell.value.includes("This statement performs a full table scan."))).toBe(true);
    expect(workspace.openNotebookDocument).toHaveBeenCalledTimes(1);
    expect(window.showNotebookDocument).toHaveBeenCalledWith(expect.anything(), { viewColumn: 2 });
  });

  it("picks a different filename when the timestamped path already exists", async () => {
    (workspace.fs.stat as Mock).mockResolvedValueOnce({} as never);

    const result = await saveDynamoDbAiAnalysisAsNotebook(buildContext(), { analysis: buildAnalysis() });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.relativePath.replace(/\\/g, "/")).toMatch(
      /^reports\/performance-tuning\/perf-tuning-analysis-orders-\d{8}-\d{6}-\d+\.dbn$/,
    );
  });
});
