import {
  compareSqlExecutions,
  ExtractedSqlResult,
} from "@l-v-yonsama/multi-platform-database-drivers";
import Excel from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspace } from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqlLogComparisonWorkbook } from "../../../src/utilities/excel/sqlLogComparisonWorkbook";

const tempDirectories: string[] = [];
afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function extracted(sql: string, line: number): ExtractedSqlResult {
  return {
    ok: true,
    stage: "sqlExecution",
    logEvents: [],
    sqlExecutions: [
      {
        startLine: line,
        endLine: line,
        comparisonSql: sql,
        sourceRanges: [{ startLine: line, endLine: line }],
      },
    ],
    inputSummary: {} as ExtractedSqlResult["inputSummary"],
    outputSummary: {} as ExtractedSqlResult["outputSummary"],
    elapsedTimeMilli: { split: 0, total: 0 },
  };
}

describe("SQL log comparison workbook", () => {
  it("shows a hyphen for WHERE match when neither SQL has a WHERE clause", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const targetExcelPath = join(directory, "no-where.xlsx");
    const result = compareSqlExecutions({
      before: extracted("SELECT * FROM t", 1),
      after: extracted("SELECT * FROM t", 1),
      options: { dialect: "mysql" },
    });
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: "old.log", text: "old SQL" },
      after: { name: "new.log", text: "new SQL" },
      targetExcelPath,
      includeEquivalentSql: true,
    });
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(targetExcelPath);
    const sheet = workbook.getWorksheet("Result")!;
    const listHeaderRow = sheet.getColumn("A").values.findIndex((value) => value === "No.");
    const detailRow = sheet.getColumn("A").values.findIndex((value) => typeof value === "string" && value.startsWith("■ SQL 1"));
    expect(sheet.getCell(`G${listHeaderRow + 1}`).value).toBe("-");
    expect(sheet.getCell(`C${detailRow + 2}`).value).toBe("-");
  });

  it("requires review when an event was not classified even if extracted SQL matched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const before = extracted("SELECT * FROM t", 1);
    before.diagnostics = { unmatchedEventCount: 1, unmatchedEventStartLines: [2] };
    const result = compareSqlExecutions({
      before,
      after: extracted("SELECT * FROM t", 1),
      options: { dialect: "mysql" },
    });
    const targetExcelPath = join(directory, "unclassified.xlsx");
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: "old.log", text: "SQL\nunclassified event" },
      after: { name: "new.log", text: "SQL" },
      targetExcelPath,
    });
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(targetExcelPath);
    expect(workbook.getWorksheet("Result")?.getCell("A2").value).toBe("Overall result: Review required");
  });

  it("shows the reason when a WHERE clause cannot be compared", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const targetExcelPath = join(directory, "unsupported-where.xlsx");
    const result = compareSqlExecutions({
      before: extracted("SELECT * FROM t WHERE id IN (SELECT id FROM other_table)", 1),
      after: extracted("SELECT * FROM t WHERE id IN (1)", 1),
      options: { dialect: "mysql" },
    });
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: "old.log", text: "old SQL" },
      after: { name: "new.log", text: "new SQL" },
      targetExcelPath,
      includeEquivalentSql: true,
    });
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(targetExcelPath);
    const sheet = workbook.getWorksheet("Result")!;
    const listHeaderRow = sheet.getColumn("A").values.findIndex((value) => value === "No.");
    expect(sheet.getCell(`G${listHeaderRow + 1}`).value).toBe("Not comparable");
    expect(sheet.getCell(`H${listHeaderRow + 1}`).value).toBe("WHERE: Before: IN subquery is not supported");
    const reasonRow = sheet.getColumn("B").values.findIndex((value) => value === "WHERE reason");
    expect(reasonRow).toBeGreaterThan(0);
    expect(sheet.getCell(`C${reasonRow}`).value).toBe("Before: IN subquery is not supported");
  });

  it("writes the CLI-style two sheets with comparison and physical source links", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const targetExcelPath = join(directory, "comparison.xlsx");
    const result = compareSqlExecutions({
      before: extracted("select * from t where id=1", 2),
      after: extracted("SELECT * FROM t WHERE id = 1", 3),
      options: { dialect: "mysql" },
    });
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: "old.log", label: "Legacy", text: "header\nold SQL\nend" },
      after: { name: "new.log", label: "Current", text: "header\nnoise\nnew SQL" },
      targetExcelPath,
      includeEquivalentSql: true,
      effectiveConfig: '{"dialect":"mysql"}',
    });
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(targetExcelPath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Result", "Log"]);
    const summary = workbook.getWorksheet("Result")!;
    const log = workbook.getWorksheet("Log")!;
    expect(summary.getCell("A1").value).toBe("Summary");
    expect(summary.getCell("A1").font.size).toBe(16);
    expect(summary.getRow(1).height).toBeUndefined();
    expect(summary.getCell("A1").note).toBe('Effective comparison config\n{"dialect":"mysql"}');
    expect(summary.getCell("A2").value).toBe("Overall result: All extracted SQL matched");
    expect(summary.getCell("A3").value).toBe("SQL statements: Before 1 (old.log); After 1 (new.log)");
    expect(summary.getCell("A4").value).toBe("Matched: 1; Equivalent: 0; Different: 0; Not comparable: 0");
    const listHeaderRow = summary.getColumn("A").values.findIndex((value) => value === "No.");
    expect(listHeaderRow).toBe(6);
    expect(summary.getCell(`F${listHeaderRow + 1}`).value).toBe("Matched");
    expect(["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((column) => summary.getColumn(column).width)).toEqual([
      5.83203125, 20, 18, 8.83203125, 4.83203125, 50, 18, 6, 50,
    ]);
    expect(["A", "B", "C", "F", "G", "H"].map((column) => summary.getCell(`${column}${listHeaderRow}`).value)).toEqual([
      "No.", "DML Type", "Table", "SQL Match Level", "WHERE match", "Reason",
    ]);
    expect(summary.getCell("I1").fill).toEqual(summary.getCell("A1").fill);
    expect(summary.getCell(`I${listHeaderRow}`).fill).toEqual(summary.getCell(`A${listHeaderRow}`).fill);
    expect(log.getCell("A1").value).toBe("[Legacy log] old.log");
    expect(log.getCell("E1").value).toBe("[Current log] new.log");
    expect(log.getCell("B1").fill).toEqual(log.getCell("A1").fill);
    expect(log.getCell("F1").fill).toEqual(log.getCell("E1").fill);
    expect(log.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FFF2F2F2" } });
    expect(["A", "B", "C", "D", "E", "F"].map((column) => log.getColumn(column).width)).toEqual([8, 102.5, 4, 4, 8, 80]);
    expect(log.getCell("A2").value).toBe(1);
    expect(log.getCell("B2").value).toBe("header");
    expect(log.getCell("E2").value).toBe(1);
    expect(log.getCell("F2").value).toBe("header");
    for (const sheet of [summary, log]) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === "string") {
          expect(cell.value).not.toMatch(/[ぁ-んァ-ン一-龯]/);
        }
      }));
    }
    expect(summary.getCell(`A${listHeaderRow + 1}`).value).toMatchObject({ hyperlink: /^#'Result'!A\d+$/ });
    expect(log.getCell("A3").fill).toMatchObject({ fgColor: { argb: "FFE6F4EA" } });
    expect(log.getCell("B3").fill).toEqual(log.getCell("A3").fill);
    expect(log.getCell("E4").fill).toMatchObject({ fgColor: { argb: "FFE6F0FF" } });
    expect(log.getCell("F4").fill).toEqual(log.getCell("E4").fill);
    const detailRow = summary.getColumn("A").values.findIndex((value) => typeof value === "string" && value.startsWith("■ SQL 1"));
    expect(detailRow).toBeGreaterThan(0);
    expect(summary.getCell(`A${detailRow}`).font.size).toBe(16);
    expect(summary.getRow(detailRow).height).toBeUndefined();
    expect(summary.getCell(`I${detailRow}`).fill).toEqual(summary.getCell(`A${detailRow}`).fill);
    expect(summary.getCell(`B${detailRow + 1}`).value).toBe("SQL Match");
    expect(summary.getCell(`C${detailRow + 1}`).value).toBe("Matched");
    expect(summary.getCell(`B${detailRow + 2}`).value).toBe("WHERE match");
    expect(summary.getCell(`B${detailRow + 5}`).value).toBe("FORMATTED SQL DIFF");
    expect(summary.getCell(`C${detailRow + 5}`).value).toBeNull();
    expect(summary.getCell(`D${detailRow + 5}`).value).toBeNull();
    expect(summary.getCell(`D${detailRow + 5}`).fill).toEqual(summary.getCell(`B${detailRow + 5}`).fill);
    const cells = summary.getColumn("F").values;
    expect(
      cells.some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "hyperlink" in value &&
          value.hyperlink === "#'Log'!B3"
      )
    ).toBe(true);
    const equivalentRow = summary.getColumn("B").values.findIndex((value) => value === "EQUIVALENT SQL DIFF");
    expect(equivalentRow).toBeGreaterThan(0);
    expect(summary.getCell(`F${equivalentRow}`).value).toBe("Same as FORMATTED SQL DIFF (no differences)");
    expect(summary.getCell(`I${equivalentRow}`).value).toBeNull();
    expect(summary.getCell(`F${equivalentRow + 1}`).value).toBeNull();
    expect(summary.getCell(`I${equivalentRow + 1}`).value).toBeNull();
    expect(summary.getColumn("A").values).not.toContain("[Inputs and diagnostics]");

    const withoutNormalizedPath = join(directory, "without-equivalent.xlsx");
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: "old.log", text: "header\nold SQL\nend" },
      after: { name: "new.log", text: "header\nnoise\nnew SQL" },
      targetExcelPath: withoutNormalizedPath,
      includeEquivalentSql: false,
    });
    const withoutNormalized = new Excel.Workbook();
    await withoutNormalized.xlsx.readFile(withoutNormalizedPath);
    expect(
      withoutNormalized
        .getWorksheet("Result")!
        .getColumn("B")
        .values.some((value) => value === "EQUIVALENT SQL DIFF")
    ).toBe(false);
  });

  it("rejects an oversized cell instead of silently truncating the source log", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const result = compareSqlExecutions({
      before: extracted("select * from t", 1),
      after: extracted("select * from t", 1),
      options: { dialect: "mysql" },
    });
    await expect(
      createSqlLogComparisonWorkbook({
        result,
        before: { name: "old.log", text: "x".repeat(32768) },
        after: { name: "new.log", text: "select * from t" },
        targetExcelPath: join(directory, "oversized.xlsx"),
      })
    ).rejects.toThrow("Excel cell text limit");
  });

  it("starts every SQL detail in column A and keeps its content from column B", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const before = extracted("select * from t", 1);
    before.sqlExecutions.push(...extracted("select * from u", 2).sqlExecutions);
    before.diagnostics = { unmatchedEventCount: 1, unmatchedEventStartLines: [3] };
    const after = extracted("select * from t", 1);
    after.sqlExecutions.push(...extracted("select * from v", 2).sqlExecutions);
    const result = compareSqlExecutions({ before, after, options: { dialect: "mysql" } });
    const targetExcelPath = join(directory, "comparison.xlsx");
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: "old.log", text: "first\nsecond\nnoise" },
      after: { name: "new.log", text: "first\nsecond" },
      targetExcelPath,
    });
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(targetExcelPath);
    const sheet = workbook.getWorksheet("Result")!;
    expect(sheet.getCell("A5").value).toContain("incompatible key: 1");
    expect(sheet.getCell("A6").value).toBe("Unclassified events: Before 1 (lines 3); After 0");
    const listHeaderRow = sheet.getColumn("A").values.findIndex((value) => value === "No.");
    expect(listHeaderRow).toBe(8);
    const detailRows = sheet.getColumn("A").values.flatMap((value, row) =>
      typeof value === "string" && value.startsWith("■ SQL ") ? [row] : []
    );
    expect(detailRows).toHaveLength(2);
    for (const row of detailRows) {
      expect(sheet.getCell(`I${row}`).fill).toEqual(sheet.getCell(`A${row}`).fill);
      expect(sheet.getCell(`B${row + 1}`).value).toBe("SQL Match");
      expect(sheet.getCell(`B${row + 2}`).value).toBe("WHERE match");
    }
    expect(sheet.getCell(`H${listHeaderRow + 2}`).value).toBe("incompatibleKey");
    expect(sheet.getCell(`F${detailRows[1] + 1}`).value).toBe("Reason: incompatibleKey");
  });

  it("uses the configured Excel theme for headings, statuses, source logs and links", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const targetExcelPath = join(directory, "themed.xlsx");
    const result = compareSqlExecutions({
      before: extracted("select * from t where created_at=NOW()", 2),
      after: extracted("SELECT * FROM t WHERE created_at=CURRENT_TIMESTAMP", 3),
      options: { dialect: "mysql" },
    });
    vi.mocked(workspace.getConfiguration).mockImplementationOnce(() => ({
      get: (key: string, fallback: unknown) => key === "Excel: Theme" ? "midnight" : fallback,
    }) as any);
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: "old.log", text: "header\nold SQL\nend" },
      after: { name: "new.log", text: "header\nnoise\nnew SQL" },
      targetExcelPath,
    });

    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(targetExcelPath);
    const summary = workbook.getWorksheet("Result")!;
    const log = workbook.getWorksheet("Log")!;
    const listHeaderRow = summary.getColumn("A").values.findIndex((value) => value === "No.");
    expect(summary.getCell(`F${listHeaderRow + 1}`).value).toBe("Equivalent match");
    const equivalentRow = summary.getColumn("B").values.findIndex((value) => value === "EQUIVALENT SQL DIFF");
    expect(equivalentRow).toBeGreaterThan(0);
    expect(summary.getCell(`F${equivalentRow}`).value).toBe("[Before EQUIVALENT SQL DIFF]");
    expect(summary.getCell(`I${equivalentRow}`).value).toBe("[After EQUIVALENT SQL DIFF]");
    expect(summary.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FF3B4B5B" } });
    expect(summary.getCell(`B${listHeaderRow}`).fill).toMatchObject({ fgColor: { argb: "FF3B4B5B" } });
    expect(summary.getCell(`F${listHeaderRow + 1}`).fill).toMatchObject({ fgColor: { argb: "FF29475A" } });
    expect(summary.getCell("I1").fill).toMatchObject({ fgColor: { argb: "FF3B4B5B" } });
    const diffRow = summary.getColumn("B").values.findIndex((value) => typeof value === "string" && value.startsWith("-"));
    expect(diffRow).toBeGreaterThan(0);
    expect(summary.getCell(`C${diffRow}`).fill).toEqual(summary.getCell(`B${diffRow}`).fill);
    expect(summary.getCell(`D${diffRow}`).fill).toEqual(summary.getCell(`B${diffRow}`).fill);
    expect(summary.getCell("A2").font.color?.argb).toBe("FFE9EDF2");
    expect(log.getCell("A3").fill).toMatchObject({ fgColor: { argb: "FF274735" } });
    expect(log.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FF3B4B5B" } });
    expect(log.getCell("B1").fill).toEqual(log.getCell("A1").fill);
    expect(log.getCell("E1").fill).toMatchObject({ fgColor: { argb: "FF3B4B5B" } });
    expect(log.getCell("F1").fill).toEqual(log.getCell("E1").fill);
    expect(log.getCell("B3").fill).toEqual(log.getCell("A3").fill);
    expect(log.getCell("E4").fill).toMatchObject({ fgColor: { argb: "FF29475A" } });
    expect(log.getCell("F4").fill).toEqual(log.getCell("E4").fill);
    expect(log.getCell("C3").fill).toMatchObject({ fgColor: { argb: "FF151B23" } });
    expect(log.properties.tabColor?.argb).toBe("FF7BB9D3");
  });

  it("keeps both merged Log headings filled with the warm theme", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sql-log-book-"));
    tempDirectories.push(directory);
    const targetExcelPath = join(directory, "warm.xlsx");
    vi.mocked(workspace.getConfiguration).mockImplementationOnce(() => ({
      get: (key: string, fallback: unknown) => key === "Excel: Theme" ? "warm" : fallback,
    }) as any);
    await createSqlLogComparisonWorkbook({
      result: compareSqlExecutions({ before: extracted("select * from t", 1), after: extracted("select * from t", 1), options: { dialect: "mysql" } }),
      before: { name: "old.log", text: "old" },
      after: { name: "new.log", text: "new" },
      targetExcelPath,
    });
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(targetExcelPath);
    const log = workbook.getWorksheet("Log")!;
    for (const address of ["A1", "B1", "E1", "F1"]) {
      expect(log.getCell(address).fill).toMatchObject({ fgColor: { argb: "FFAA482F" } });
    }
  });
});
