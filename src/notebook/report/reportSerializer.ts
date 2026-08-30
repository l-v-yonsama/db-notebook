import { TextDecoder, TextEncoder } from "util";
import {
  CancellationToken,
  NotebookCellData,
  NotebookCellKind,
  NotebookData,
  NotebookSerializer,
} from "vscode";
import { deserializeReportCellOutput, serializeReportCellOutput } from "./reportCellOutputCodec";
import type { RawReportNotebookData, ReportCellMetadata, ReportKind } from "./reportTypes";

const REPORT_KINDS = new Set<ReportKind>(["aws-cloudwatch-metrics", "rdb-database"]);

function parseReport(data: Uint8Array): RawReportNotebookData {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(data));
  } catch (error) {
    throw new Error(`Invalid dashboard report JSON: ${String(error)}`);
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid dashboard report: the root value must be an object.");
  }
  const raw = value as Partial<RawReportNotebookData>;
  if (raw.formatVersion !== 1) {
    throw new Error(`Unsupported dashboard report formatVersion: ${String(raw.formatVersion)}.`);
  }
  if (!REPORT_KINDS.has(raw.reportKind as ReportKind)) {
    throw new Error(`Unsupported dashboard report kind: ${String(raw.reportKind)}.`);
  }
  if (!Array.isArray(raw.cells)) {
    throw new Error("Invalid dashboard report: cells must be an array.");
  }
  for (const [index, cell] of raw.cells.entries()) {
    if (
      !cell ||
      ![NotebookCellKind.Markup, NotebookCellKind.Code].includes(cell.kind) ||
      typeof cell.language !== "string" ||
      typeof cell.value !== "string" ||
      (cell.outputs !== undefined && !Array.isArray(cell.outputs))
    ) {
      throw new Error(`Invalid dashboard report cell at index ${index}.`);
    }
  }
  return raw as RawReportNotebookData;
}

export class DBNotebookReportSerializer implements NotebookSerializer {
  async deserializeNotebook(data: Uint8Array, _token: CancellationToken): Promise<NotebookData> {
    const raw = parseReport(data);
    const cells = raw.cells.map((item) => {
      const cell = new NotebookCellData(item.kind, item.value, item.language);
      cell.metadata = item.metadata ?? {};
      cell.outputs = (item.outputs ?? []).map(deserializeReportCellOutput);
      return cell;
    });
    const book = new NotebookData(cells);
    book.metadata = {
      ...(raw.metadata ?? {}),
      formatVersion: raw.formatVersion,
      reportKind: raw.reportKind,
    };
    return book;
  }

  async serializeNotebook(data: NotebookData, _token: CancellationToken): Promise<Uint8Array> {
    const reportKind = data.metadata?.reportKind as ReportKind | undefined;
    if (!reportKind || !REPORT_KINDS.has(reportKind)) {
      throw new Error("Dashboard report metadata.reportKind is missing or unsupported.");
    }
    const {
      formatVersion: _formatVersion,
      reportKind: _reportKind,
      ...metadata
    } = data.metadata ?? {};
    const raw: RawReportNotebookData = {
      formatVersion: 1,
      reportKind,
      metadata,
      cells: data.cells.map((cell) => ({
        kind: cell.kind,
        language: cell.languageId,
        value: cell.value,
        metadata: (cell.metadata ?? {}) as ReportCellMetadata,
        outputs: (cell.outputs ?? []).map(serializeReportCellOutput),
      })),
    };
    return new TextEncoder().encode(JSON.stringify(raw, null, 1));
  }
}
