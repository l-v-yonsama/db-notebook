import { LOG_EVENT_SPLIT_PRESETS, SQL_LOG_PARSE_PRESETS } from "@l-v-yonsama/multi-platform-database-drivers";
import Excel from "exceljs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileType, Uri, workspace } from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSqlLogComparison, SqlLogComparisonCancelled } from "../../src/utilities/sqlLogComparison/runComparison";

const directories: string[] = [];
const sqlLog = [
  "2026-03-12 10:11:22 DEBUG query.AutoSelectImpl - SELECT *",
  "FROM t",
  "WHERE id = 1",
  "2026-03-12 10:11:23 INFO service - 完了",
].join("\n");

async function files(beforeText = sqlLog, afterText = sqlLog) {
  const directory = await mkdtemp(join(tmpdir(), "sql-compare-run-"));
  directories.push(directory);
  const beforeFile = Uri.file(join(directory, "old.log"));
  const afterFile = Uri.file(join(directory, "new.log"));
  const parserFile = Uri.file(join(directory, "s2.log-parser.config.json"));
  const outputFile = Uri.file(join(directory, "result.xlsx"));
  await writeFile(beforeFile.fsPath, beforeText);
  await writeFile(afterFile.fsPath, afterText);
  await writeFile(parserFile.fsPath, JSON.stringify({ split: LOG_EVENT_SPLIT_PRESETS.Simple.split, ...SQL_LOG_PARSE_PRESETS.S2Jdbc }));
  const settings = {
    beforeParserConfigFile: parserFile, afterParserConfigFile: parserFile,
    dialect: "mysql" as const,
  };
  return { directory, beforeFile, afterFile, outputFile, settings };
}

beforeEach(() => {
  vi.mocked(workspace.fs.readFile).mockImplementation(async (uri) => readFile(uri.fsPath));
  vi.mocked(workspace.fs.stat).mockImplementation(async (uri) => {
    const info = await stat(uri.fsPath);
    return { type: info.isFile() ? FileType.File : FileType.Directory, ctime: 0, mtime: 0, size: info.size };
  });
});
afterEach(async () => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {await rm(directory, { recursive: true, force: true });}
});

describe("SQL log comparison run", () => {
  it("uses two selected files and parser configs to write a two-sheet report", async () => {
    const { beforeFile, afterFile, settings, outputFile } = await files();
    const stages: string[] = [];
    const result = await runSqlLogComparison({ beforeFile, afterFile, settings, outputFile, extensionVersion: "4.0.0", report: (message) => stages.push(message) });
    expect(result.summary).toMatchObject({ beforeSqlCount: 1, afterSqlCount: 1, formattedMatched: 1 });
    expect(stages).toEqual(["Reading parser configs", "Reading old and new logs", "Extracting SQL", "Comparing SQL", "Creating Excel report"]);
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(outputFile.fsPath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Result", "Log"]);
    expect(workbook.getWorksheet("Result")?.getCell("A2").value).toBe("Overall result: All extracted SQL matched");
    expect(workbook.getWorksheet("Log")?.getCell("A1").value).toBe("[Before log] old.log");
    expect(workbook.getWorksheet("Log")?.getCell("E1").value).toBe("[After log] new.log");
    expect(workbook.getWorksheet("Log")?.getCell("A2").value).toBe(1);
    expect(workbook.getWorksheet("Log")?.getCell("B2").value).toContain("SELECT *");
    expect(workbook.getWorksheet("Log")?.getCell("B5").value).toContain("完了");
  });

  it.each([
    ["sqlite", "SELECT * FROM main.users WHERE id = 1 LIMIT 1", "main.users"],
    ["plsql", 'SELECT * FROM "HR"."EMPLOYEES" WHERE employee_id = 1 FETCH FIRST 1 ROWS ONLY', "HR.EMPLOYEES"],
  ] as const)("compares %s logs and records the dialect in the report", async (dialect, sql, table) => {
    const text = `2026-03-12 10:11:22 DEBUG query.AutoSelectImpl - ${sql}`;
    const { beforeFile, afterFile, settings, outputFile } = await files(text, text);
    const result = await runSqlLogComparison({
      beforeFile, afterFile, settings: { ...settings, dialect }, outputFile, extensionVersion: "4.0.0",
    });
    expect(result.summary.formattedMatched).toBe(1);
    expect(result.before[0].meta.table).toBe(table);
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(outputFile.fsPath);
    expect(workbook.getWorksheet("Result")?.getCell("A1").note).toContain(`"dialect":"${dialect}"`);
  });

  it("writes a review report when no SQL was extracted", async () => {
    const { beforeFile, afterFile, settings, outputFile } = await files("2026-03-12 10:11:22 INFO service - done", "2026-03-12 10:11:22 INFO service - done");
    const result = await runSqlLogComparison({ beforeFile, afterFile, settings, outputFile, extensionVersion: "4.0.0" });
    expect(result.summary.beforeSqlCount).toBe(0);
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(outputFile.fsPath);
    expect(workbook.getWorksheet("Result")?.getCell("A2").value).toBe("Overall result: Review required");
  });

  it("tracks Seasar and MyBatis SQL through extraction, comparison and Excel", async () => {
    const oldText = "1999-01-01T14:52:34.503+09:00 DEBUG 30 --- [main] query.SqlFileUpdateImpl : update users set name = 'alice' where id = 9";
    const newText = [
      "2026-03-13T11:20:54.404+09:00 DEBUG 389 --- [           main] com.example.demo.MyBatisService          : start",
      "2026-03-13T11:20:54.405+09:00 DEBUG 389 --- [           main] c.example.demo.MyBatisUserMapper.update  : ==>  Preparing: update users set name = ? where id = ?",
      "2026-03-13T11:20:54.406+09:00 DEBUG 389 --- [           main] c.example.demo.MyBatisUserMapper.update  : ==> Parameters: alice(String), 9(Integer)",
    ].join("\n");
    const { directory, beforeFile, afterFile, outputFile } = await files(oldText, newText);
    const oldParser = join(directory, "old.log-parser.config.json");
    const newParser = join(directory, "new.log-parser.config.json");
    await writeFile(oldParser, JSON.stringify({ split: LOG_EVENT_SPLIT_PRESETS.SpringBoot.split, ...SQL_LOG_PARSE_PRESETS.S2Jdbc }));
    await writeFile(newParser, JSON.stringify({ split: LOG_EVENT_SPLIT_PRESETS.SpringBoot.split, ...SQL_LOG_PARSE_PRESETS.MyBatis }));
    const result = await runSqlLogComparison({
      beforeFile, afterFile, outputFile, extensionVersion: "4.0.0",
      settings: {
        beforeParserConfigFile: Uri.file(oldParser), afterParserConfigFile: Uri.file(newParser),
        dialect: "mysql",
      },
    });
    expect(result.summary).toMatchObject({ beforeSqlCount: 1, afterSqlCount: 1 });
    expect(result.before[0].sourceRanges[0].startLine).toBe(1);
    expect(result.after[0].sourceRanges[0].startLine).toBe(2);
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(outputFile.fsPath);
    expect(workbook.getWorksheet("Log")?.getCell("B2").value).toContain("update users");
    expect(workbook.getWorksheet("Log")?.getCell("F3").value).toContain("Preparing: update users");
    expect(workbook.getWorksheet("Result")?.getCell("A3").value).toContain("Before 1 (old.log); After 1 (new.log)");
  });

  it("preserves an existing report when cancelled or Excel creation fails", async () => {
    const { directory, beforeFile, afterFile, settings, outputFile } = await files("x".repeat(32768));
    await writeFile(outputFile.fsPath, "existing report");
    const params = { beforeFile, afterFile, settings, outputFile, extensionVersion: "4.0.0" };
    await expect(runSqlLogComparison({ ...params, token: { isCancellationRequested: true } as any })).rejects.toBeInstanceOf(SqlLogComparisonCancelled);
    await expect(runSqlLogComparison(params)).rejects.toThrow("Excel cell text limit");
    expect(await readFile(outputFile.fsPath, "utf8")).toBe("existing report");
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp.xlsx"))).toBe(false);
  });

  it("cleans up a temporary report when the final save fails", async () => {
    const { directory, beforeFile, afterFile, settings, outputFile } = await files();
    await mkdir(outputFile.fsPath);
    await expect(runSqlLogComparison({ beforeFile, afterFile, settings, outputFile, extensionVersion: "4.0.0" })).rejects.toThrow();
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp.xlsx"))).toBe(false);
  });
});
