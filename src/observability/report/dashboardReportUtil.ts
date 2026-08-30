import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import {
  NotebookCellData,
  NotebookCellKind,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookData,
} from "vscode";
import type {
  PersistedReportOutputMetadata,
  ReportChartSpec,
  ReportKind,
} from "../../notebook/report/reportTypes";

export function sanitizeDashboardFilenamePart(
  value: string,
  fallback: string,
  maxLength?: number
): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (maxLength === undefined ? sanitized : sanitized.slice(0, maxLength)) || fallback;
}

export function dashboardTimestampSuffix(value: string): string {
  const date = new Date(value);
  const pad2 = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

export function buildDashboardResultSet(rows: Array<Record<string, unknown>>): ResultSetData {
  if (rows.length === 0) {
    return ResultSetDataBuilder.createEmpty({ noRecordsReason: "No records" }).build();
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const builder = new ResultSetDataBuilder(keys);
  rows.forEach((row) => builder.addRow(row));
  builder.resetKeyTypeByRows();
  return builder.build();
}

export function createPersistedDashboardResultSetCell(params: {
  rows: Array<Record<string, unknown>>;
  label: string;
  contextParts: readonly string[];
  requestSourceLabel: string;
  reportChart?: ReportChartSpec;
}): NotebookCellData {
  const { rows, label, contextParts, requestSourceLabel, reportChart } = params;
  const rdh = buildDashboardResultSet(rows);
  const noRequestMessage = `No ${requestSourceLabel} request is executed from this cell.`;
  const cell = new NotebookCellData(
    NotebookCellKind.Code,
    `Saved dashboard snapshot: ${label}. ${noRequestMessage}`,
    "plaintext"
  );
  cell.metadata = {
    cellLabel: label,
    inputCollapsed: true,
    ...(reportChart ? { reportChart } : {}),
  };
  const metadata: PersistedReportOutputMetadata = {
    schemaVersion: 1,
    kind: "result-set",
    rdh,
  };
  cell.outputs = [
    new NotebookCellOutput(
      [
        NotebookCellOutputItem.text(
          [
            `### ${label}`,
            "",
            contextParts.map(markdownCode).join(" · "),
            "",
            `> Saved dashboard snapshot. ${noRequestMessage}`,
            "",
            `\`[Saved result]\` ${rows.length} row(s)`,
            ResultSetDataBuilder.from(rdh).toMarkdown({ maxPrintLines: 10 }),
          ].join("\n"),
          "text/markdown"
        ),
      ],
      metadata
    ),
  ];
  return cell;
}

export function createDashboardReportNotebook(
  cells: NotebookCellData[],
  metadata: { reportKind: ReportKind; dashboardId: string; collectedAt: string }
): NotebookData {
  const report = new NotebookData(cells);
  report.metadata = {
    formatVersion: 1,
    ...metadata,
  };
  return report;
}

function markdownCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}
