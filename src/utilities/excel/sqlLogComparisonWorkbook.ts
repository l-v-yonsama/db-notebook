import {
  LogSqlComparisonRecord,
  LogSqlComparisonResult,
} from "@l-v-yonsama/multi-platform-database-drivers";
import Excel from "exceljs";
import { getOutputConfig } from "../configUtil";
import { applyExcelTheme, registerExcelThemeDataRange } from "./excelTheme";

export type SqlLogComparisonWorkbookParams = {
  result: LogSqlComparisonResult;
  before: { name: string; text: string; label?: string };
  after: { name: string; text: string; label?: string };
  targetExcelPath: string;
  includeEquivalentSql?: boolean;
  effectiveConfig?: string;
};

const COLORS = {
  header: "FFF2F2F2",
  exact: "FFCCFFCC",
  equivalent: "FFE6F4EA",
  diff: "FFFFCCCC",
  skip: "FFFFFFCC",
  before: "FFE6F4EA",
  after: "FFE6F0FF",
  addition: "FFE6F4EA",
};

function checkCell(value: string): string {
  if (value.length > 32767) {
    throw new Error("Excel cell text limit exceeded");
  }
  return value;
}

function setText(sheet: Excel.Worksheet, address: string, value: string): Excel.Cell {
  const cell = sheet.getCell(address);
  cell.value = checkCell(value);
  return cell;
}

function fill(cell: Excel.Cell, color: string): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
}

function link(cell: Excel.Cell, text: string, address: string): void {
  cell.value = { text: checkCell(text), hyperlink: `#${address}` };
  cell.font = { color: { argb: "FF0563C1" }, underline: true };
}

function lines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

function lineMarks(records: LogSqlComparisonRecord[]): Set<number> {
  const marks = new Set<number>();
  for (const record of records) {
    for (const range of record.sourceRanges) {
      for (let line = range.startLine; line <= range.endLine; line++) {
        marks.add(line);
      }
    }
  }
  return marks;
}

function statusLabel(level: string): string {
  return (
    (
      {
        FORMATTED_MATCH: "Matched",
        EQUIVALENT_MATCH: "Equivalent match",
        DIFF: "Different",
        SKIP: "Not comparable",
      } as Record<string, string>
    )[level] ?? level
  );
}

function matchColor(level: string, themed: boolean): string {
  if (level === "EQUIVALENT_MATCH" && themed) {
    return "FFD9EDF7";
  }
  return COLORS[
    level === "FORMATTED_MATCH"
      ? "exact"
      : level === "EQUIVALENT_MATCH"
      ? "equivalent"
      : level === "DIFF"
      ? "diff"
      : "skip"
  ];
}

function whereLabel(status: string): string {
  return (
    (
      {
        matched: "Matched",
        different: "Different",
        notApplicable: "-",
        notComparable: "Not comparable",
      } as Record<string, string>
    )[status] ?? status
  );
}

function overall(result: LogSqlComparisonResult): string {
  const reasons = result.summary.skipReasonCounts;
  if (!result.summary.beforeSqlCount || !result.summary.afterSqlCount) {
    return "Review required";
  }
  if (
    result.summary.unmatched ||
    reasons.missingBefore ||
    reasons.missingAfter ||
    reasons.incompatibleKey
  ) {
    return "Differences found";
  }
  if (result.summary.skipped) {
    return "Review required";
  }
  if ((result.diagnostics.before?.unmatchedEventCount ?? 0) > 0 ||
    (result.diagnostics.after?.unmatchedEventCount ?? 0) > 0) {
    return "Review required";
  }
  return "All extracted SQL matched";
}

/** CLI's Result/Log layout with source links and explicit comparison statuses. */
export async function createSqlLogComparisonWorkbook(
  params: SqlLogComparisonWorkbookParams
): Promise<string> {
  const { result, before, after, targetExcelPath, includeEquivalentSql = true } = params;
  const theme = getOutputConfig().excel.theme;
  const themed = theme !== "unspecified";
  const headerColor = themed ? "FF444444" : COLORS.header;
  const beforeLines = lines(before.text);
  const afterLines = lines(after.text);
  const maxLogLines = Math.max(beforeLines.length, afterLines.length);
  if (maxLogLines + 2 > 1048576) {
    throw new Error("Excel row limit exceeded");
  }

  const book = new Excel.Workbook();
  const sheet = book.addWorksheet("Result");
  sheet.columns = [
    { width: 5.83203125 },
    { width: 20 },
    { width: 18 },
    { width: 8.83203125 },
    { width: 4.83203125 },
    { width: 50 },
    { width: 18 },
    { width: 6 },
    { width: 50 },
  ];
  const log = book.addWorksheet("Log");
  log.columns = [{ width: 8 }, { width: 102.5 }, { width: 4 }, { width: 4 }, { width: 8 }, { width: 80 }];
  const beforeLabel = before.label ?? "Before";
  const afterLabel = after.label ?? "After";
  fill(setText(log, "A1", `[${beforeLabel} log] ${before.name}`), headerColor);
  fill(setText(log, "E1", `[${afterLabel} log] ${after.name}`), headerColor);
  const beforeMarks = lineMarks(result.before);
  const afterMarks = lineMarks(result.after);
  for (let i = 0; i < maxLogLines; i++) {
    if (i < beforeLines.length) {
      const number = log.getCell(`A${i + 2}`);
      number.value = i + 1;
      number.alignment = { horizontal: "right" };
      const cell = setText(log, `B${i + 2}`, beforeLines[i]);
      if (beforeMarks.has(i + 1)) {
        fill(number, COLORS.before);
        fill(cell, COLORS.before);
      }
    }
    if (i < afterLines.length) {
      const number = log.getCell(`E${i + 2}`);
      number.value = i + 1;
      number.alignment = { horizontal: "right" };
      const cell = setText(log, `F${i + 2}`, afterLines[i]);
      if (afterMarks.has(i + 1)) {
        fill(number, COLORS.after);
        fill(cell, COLORS.after);
      }
    }
  }

  const summary = result.summary;
  const summaryLines = [
    `Overall result: ${overall(result)}`,
    `SQL statements: Before ${summary.beforeSqlCount} (${before.name}); After ${summary.afterSqlCount} (${after.name})`,
    `Matched: ${summary.formattedMatched}; Equivalent: ${summary.equivalentMatched}; Different: ${summary.unmatched}; Not comparable: ${summary.skipped}`,
  ];
  const skipReasons = Object.entries(summary.skipReasonCounts);
  if (skipReasons.length) {
    summaryLines.push(`Not comparable reasons: ${skipReasons.map(([reason, count]) =>
      `${reason.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${count}`).join("; ")}`);
  }
  const beforeUnclassified = result.diagnostics.before?.unmatchedEventCount ?? 0;
  const afterUnclassified = result.diagnostics.after?.unmatchedEventCount ?? 0;
  if (beforeUnclassified || afterUnclassified) {
    const describe = (count: number, starts?: number[]): string =>
      `${count}${starts?.length ? ` (lines ${starts.join(", ")})` : ""}`;
    summaryLines.push(`Unclassified events: Before ${describe(beforeUnclassified, result.diagnostics.before?.unmatchedEventStartLines)}; After ${describe(afterUnclassified, result.diagnostics.after?.unmatchedEventStartLines)}`);
  }
  const listHeaderRow = summaryLines.length + 3;
  const fullWidthHeadings = [1, listHeaderRow];
  const diffHeadings: number[] = [];
  fill(setText(sheet, "A1", "Summary"), headerColor);
  if (params.effectiveConfig) {
    sheet.getCell("A1").note = `Effective comparison config\n${params.effectiveConfig}`;
  }
  summaryLines.forEach((text, index) => {
    const rowNumber = index + 2;
    sheet.mergeCells(`A${rowNumber}:I${rowNumber}`);
    setText(sheet, `A${rowNumber}`, text);
  });
  for (const [column, heading] of [
    ["A", "No."], ["B", "DML Type"], ["C", "Table"],
    ["F", "SQL Match Level"], ["G", "WHERE match"], ["H", "Reason"],
  ]) {
    fill(setText(sheet, `${column}${listHeaderRow}`, heading), headerColor);
  }
  const byBefore = new Map(result.before.map((record) => [record.id, record]));
  const byAfter = new Map(result.after.map((record) => [record.id, record]));
  const detailRows = new Map<number, number>();
  let row = listHeaderRow + result.details.length + 3;
  const drawLines = (
    title: string,
    a: string | undefined,
    d: string | undefined,
    g: string | undefined
  ): void => {
    diffHeadings.push(row);
    fill(setText(sheet, `B${row}`, title), headerColor);
    fill(
      setText(sheet, `F${row}`, d ? `[${beforeLabel} ${title}]` : `[${beforeLabel}]`),
      headerColor
    );
    fill(
      setText(sheet, `I${row}`, g ? `[${afterLabel} ${title}]` : `[${afterLabel}]`),
      headerColor
    );
    row++;
    const al = a ? lines(a) : [];
    const dl = d ? lines(d) : [];
    const gl = g ? lines(g) : [];
    for (let i = 0; i < Math.max(al.length, dl.length, gl.length); i++) {
      if (al[i] !== undefined) {
        const cell = setText(sheet, `B${row}`, al[i]);
        const color = al[i].startsWith("+") ? COLORS.addition
          : al[i].startsWith("-") ? COLORS.diff : undefined;
        if (color) {
          for (const column of ["B", "C", "D"]) {
            fill(column === "B" ? cell : sheet.getCell(`${column}${row}`), color);
          }
        }
      }
      if (dl[i] !== undefined) {
        setText(sheet, `F${row}`, dl[i]);
      }
      if (gl[i] !== undefined) {
        setText(sheet, `I${row}`, gl[i]);
      }
      row++;
    }
  };
  for (const detail of result.details) {
    const b = detail.beforeId ? byBefore.get(detail.beforeId) : undefined;
    const a = detail.afterId ? byAfter.get(detail.afterId) : undefined;
    detailRows.set(detail.index, row);
    fullWidthHeadings.push(row);
    fill(
      setText(
        sheet,
        `A${row}`,
        `■ SQL ${detail.index} [${a?.meta.dml ?? b?.meta.dml ?? "UNKNOWN"}](${
          a?.meta.table ?? b?.meta.table ?? "-"
        })`
      ),
      headerColor
    );
    row++;
    setText(sheet, `B${row}`, "SQL Match");
    fill(
      setText(sheet, `C${row}`, statusLabel(detail.sqlMatchLevel)),
      matchColor(detail.sqlMatchLevel, themed)
    );
    fill(sheet.getCell(`D${row}`), matchColor(detail.sqlMatchLevel, themed));
    if (detail.reason) {
      setText(sheet, `F${row}`, `Reason: ${detail.reason}`);
    }
    row++;
    setText(sheet, `B${row}`, "WHERE match");
    setText(sheet, `C${row}`, whereLabel(detail.where.status));
    for (const [record, source, sourceLines, column, logColumn] of [
      [b, before, beforeLines, "F", "B"],
      [a, after, afterLines, "I", "F"],
    ] as const) {
      if (record) {
        const sourceLine = record.sourceRanges[0]?.startLine ?? record.startLine;
        if (sourceLine < 1 || sourceLine > sourceLines.length) {
          throw new Error("SQL source line is outside the log");
        }
        const ranges = record.sourceRanges.length
          ? record.sourceRanges
          : [{ startLine: record.startLine, endLine: record.endLine }];
        const rangeLabel = ranges
          .map((range) =>
            range.startLine === range.endLine
              ? `${range.startLine}`
              : `${range.startLine}-${range.endLine}`
          )
          .join(", ");
        link(
          sheet.getCell(`${column}${row}`),
          `${record.id} ${source.name}:${rangeLabel}`,
          `'Log'!${logColumn}${sourceLine + 1}`
        );
      }
    }
    row++;
    for (const [record, column] of [
      [b, "F"],
      [a, "I"],
    ] as const) {
      if (record) {
        const attributes = [
          record.timestamp ? `Timestamp: ${record.timestamp}` : "",
          record.thread ? `Thread: ${record.thread}` : "",
          record.daoClass
            ? `DAO: ${record.daoClass}${record.daoMethod ? `.${record.daoMethod}` : ""}`
            : "",
          record.rawParameters?.length ? `Original binds: ${record.rawParameters.join(" | ")}` : "",
          record.issues.length
            ? `Issues: ${record.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" | ")}`
            : "",
        ].filter(Boolean);
        if (attributes.length) {
          setText(sheet, `${column}${row}`, attributes.join(" / "));
        }
      }
    }
    row++;
    if (detail.where.onlyBefore?.length || detail.where.onlyAfter?.length) {
      setText(sheet, `F${row}`, `Before only: ${detail.where.onlyBefore?.join(" | ") ?? ""}`);
      setText(sheet, `I${row}`, `After only: ${detail.where.onlyAfter?.join(" | ") ?? ""}`);
      row++;
    }
    if (detail.where.reason) {
      setText(sheet, `B${row}`, "WHERE reason");
      sheet.mergeCells(`C${row}:I${row}`);
      setText(sheet, `C${row}`, detail.where.reason);
      row++;
    }
    row++;
    drawLines("FORMATTED SQL DIFF", detail.diffFormattedText, b?.formattedSql, a?.formattedSql);
    if (includeEquivalentSql) {
      row += 2;
      if (detail.sqlMatchLevel === "FORMATTED_MATCH") {
        diffHeadings.push(row);
        fill(setText(sheet, `B${row}`, "EQUIVALENT SQL DIFF"), headerColor);
        setText(sheet, `F${row}`, "Same as FORMATTED SQL DIFF (no differences)");
        row++;
      } else {
        drawLines(
          "EQUIVALENT SQL DIFF",
          detail.diffEquivalentText,
          b?.equivalentSql,
          a?.equivalentSql
        );
      }
    }
    row += 2;
  }
  for (const detail of result.details) {
    const b = detail.beforeId ? byBefore.get(detail.beforeId) : undefined;
    const a = detail.afterId ? byAfter.get(detail.afterId) : undefined;
    const listRow = detail.index + listHeaderRow;
    link(
      sheet.getCell(`A${listRow}`),
      String(detail.index),
      `'Result'!A${detailRows.get(detail.index)}`
    );
    setText(sheet, `B${listRow}`, a?.meta.dml ?? b?.meta.dml ?? "UNKNOWN");
    setText(sheet, `C${listRow}`, a?.meta.table ?? b?.meta.table ?? "");
    fill(
      setText(sheet, `F${listRow}`, statusLabel(detail.sqlMatchLevel)),
      matchColor(detail.sqlMatchLevel, themed)
    );
    setText(sheet, `G${listRow}`, whereLabel(detail.where.status));
    if (detail.reason || detail.where.reason) {
      setText(sheet, `H${listRow}`, detail.reason ?? `WHERE: ${detail.where.reason}`);
    }
  }
  if (row > 1048576) {
    throw new Error("Excel row limit exceeded");
  }
  registerExcelThemeDataRange(sheet, { firstRow: 1, lastRow: row - 1, firstCol: 1, lastCol: 9 });
  registerExcelThemeDataRange(log, { firstRow: 1, lastRow: maxLogLines + 1, firstCol: 1, lastCol: 6 });
  applyExcelTheme(book, theme);
  for (const headingRow of fullWidthHeadings) {
    const headingFill = sheet.getCell(`A${headingRow}`).fill;
    for (let column = 2; column <= 9; column++) {
      sheet.getCell(headingRow, column).fill = headingFill;
    }
  }
  for (const headingRow of diffHeadings) {
    const headingFill = sheet.getCell(`B${headingRow}`).fill;
    sheet.getCell(`C${headingRow}`).fill = headingFill;
    sheet.getCell(`D${headingRow}`).fill = headingFill;
  }
  for (const headingRow of [1, ...detailRows.values()]) {
    const heading = sheet.getCell(`A${headingRow}`);
    heading.font = { ...heading.font, size: 16, bold: true };
  }
  log.mergeCells("A1:B1");
  log.mergeCells("E1:F1");
  await book.xlsx.writeFile(targetExcelPath);
  return targetExcelPath;
}
