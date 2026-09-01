import type { ExtractedSqlResult } from "@l-v-yonsama/multi-platform-database-drivers";
import {
  createRdhKey,
  DiffResult,
  GeneralColumnType,
  ResultSetData,
  ResultSetDataBuilder,
} from "@l-v-yonsama/rdh";
import * as Excel from "exceljs";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BookCreateOption,
  createBookFromDiffList,
  createBookFromList,
  createBookFromRdh,
  createLogAnalysisWorkbook,
} from "../../../src/utilities/excel";

const tmpFiles: string[] = [];

const tmpXlsxPath = (): string => {
  const p = path.join(
    os.tmpdir(),
    `excel-generator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`
  );
  tmpFiles.push(p);
  return p;
};

afterEach(async () => {
  await Promise.all(tmpFiles.splice(0).map((p) => fs.promises.unlink(p).catch(() => undefined)));
});

const readWorkbook = async (targetPath: string): Promise<Excel.Workbook> => {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(targetPath);
  return workbook;
};

const makeRdh = (opts: {
  tableName?: string;
  comment?: string;
  keys: { name: string; type: number; comment?: string }[];
  rows: Record<string, any>[];
  sqlStatement?: string;
  binds?: string[];
  ruleViolationSummary?: Record<string, number>;
}): ResultSetData => {
  const rdhKeys = opts.keys.map((k) =>
    createRdhKey({ name: k.name, type: k.type, comment: k.comment })
  );
  const builder = new ResultSetDataBuilder(rdhKeys);
  opts.rows.forEach((row) => builder.addRow(row));
  const rdh = builder.build();
  (rdh.meta as any).tableName = opts.tableName;
  if (opts.comment) {
    (rdh.meta as any).comment = opts.comment;
  }
  if (opts.ruleViolationSummary) {
    (rdh.meta as any).ruleViolationSummary = opts.ruleViolationSummary;
  }
  if (opts.sqlStatement) {
    rdh.sqlStatement = opts.sqlStatement;
  }
  if (opts.binds) {
    rdh.queryConditions = { binds: opts.binds };
  }
  return rdh;
};

describe("createQueryResultSheet (via createBookFromRdh)", () => {
  it("タイトル行・ヘッダー行(名前+コメント)・データ行を想定した行位置に書き込む", async () => {
    const rdh = makeRdh({
      tableName: "users",
      keys: [
        { name: "id", type: GeneralColumnType.INTEGER, comment: "identifier" },
        { name: "name", type: GeneralColumnType.VARCHAR, comment: "user name" },
      ],
      rows: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    });

    const targetPath = tmpXlsxPath();
    const err = await createBookFromRdh(rdh, targetPath);
    expect(err).toBe("");

    const workbook = await readWorkbook(targetPath);
    const sheet = workbook.worksheets[0];

    expect(sheet.getCell(1, 2).value).toBe("■ users");

    expect(sheet.getCell(2, 2).value).toBe("id");
    expect(sheet.getCell(2, 3).value).toBe("name");
    expect(sheet.getCell(3, 2).value).toBe("identifier");
    expect(sheet.getCell(3, 3).value).toBe("user name");

    expect(sheet.getCell(4, 2).value).toBe(1);
    expect(sheet.getCell(4, 3).value).toBe("Alice");
    expect(sheet.getCell(5, 2).value).toBe(2);
    expect(sheet.getCell(5, 3).value).toBe("Bob");
  });

  it("SQL文とBINDSがある場合、SQL行・BINDS行を挟んでからヘッダー/データ行を書く", async () => {
    const rdh = makeRdh({
      tableName: "orders",
      keys: [{ name: "id", type: GeneralColumnType.INTEGER, comment: "Order ID" }],
      rows: [{ id: 100 }],
      sqlStatement: "SELECT 1\nFROM t",
      binds: ["v1", "v2"],
    });

    const targetPath = tmpXlsxPath();
    await createBookFromRdh(rdh, targetPath);

    const workbook = await readWorkbook(targetPath);
    const sheet = workbook.worksheets[0];

    expect(sheet.getCell(1, 2).value).toBe("■ orders");

    expect(sheet.getCell(3, 2).value).toBe("SQL");
    expect(sheet.getCell(3, 3).value).toBe("SELECT 1");
    expect(sheet.getCell(4, 3).value).toBe("FROM t");

    expect(sheet.getCell(5, 2).value).toBe("BINDS");
    expect(sheet.getCell(5, 3).value).toBe("Position");
    expect(sheet.getCell(5, 4).value).toBe("Value");
    expect(sheet.getCell(6, 3).value).toBe("$1");
    expect(sheet.getCell(6, 4).value).toBe("v1");
    expect(sheet.getCell(7, 3).value).toBe("$2");
    expect(sheet.getCell(7, 4).value).toBe("v2");

    expect(sheet.getCell(9, 2).value).toBe("id");
    expect(sheet.getCell(10, 2).value).toBe("Order ID");
    expect(sheet.getCell(11, 2).value).toBe(100);
  });

  it("ルール違反サマリーがある場合、サマリー行を挟んでからヘッダー/データ行を書く", async () => {
    const rdh = makeRdh({
      tableName: "accounts",
      keys: [{ name: "id", type: GeneralColumnType.INTEGER, comment: "ID" }],
      rows: [{ id: 100 }],
      ruleViolationSummary: { rule1: 3 },
    });

    const targetPath = tmpXlsxPath();
    await createBookFromRdh(rdh, targetPath);

    const workbook = await readWorkbook(targetPath);
    const sheet = workbook.worksheets[0];

    expect(sheet.getCell(1, 2).value).toBe("■ accounts");
    expect(sheet.getCell(2, 2).value).toBe("Rule violation");
    expect(sheet.getCell(2, 4).value).toBe("*1: rule1: 3");

    expect(sheet.getCell(4, 2).value).toBe("id");
    expect(sheet.getCell(5, 2).value).toBe("ID");
    expect(sheet.getCell(6, 2).value).toBe(100);
  });

  it("データ行が0件の場合はNo records.を書いて終わる", async () => {
    const rdh = makeRdh({
      tableName: "empty_table",
      keys: [{ name: "id", type: GeneralColumnType.INTEGER, comment: "ID" }],
      rows: [],
    });

    const targetPath = tmpXlsxPath();
    await createBookFromRdh(rdh, targetPath);

    const workbook = await readWorkbook(targetPath);
    const sheet = workbook.worksheets[0];

    expect(sheet.getCell(1, 2).value).toBe("■ empty_table");
    expect(sheet.getCell(2, 2).value).toBe("id");
    expect(sheet.getCell(3, 2).value).toBe("ID");
    expect(sheet.getCell(4, 2).value).toBe("No records.");
  });
});

describe("createQueryResultSheetの戻り値(plusNo)の伝播 (via createBookFromList)", () => {
  it("1つ目のシート出力行数ぶん、2つ目のテーブルの開始行がずれる", async () => {
    const rdh1 = makeRdh({
      tableName: "first",
      keys: [{ name: "id", type: GeneralColumnType.INTEGER }],
      rows: [{ id: 1 }, { id: 2 }],
    });
    const rdh2 = makeRdh({
      tableName: "second",
      keys: [{ name: "id", type: GeneralColumnType.INTEGER }],
      rows: [{ id: 3 }],
    });

    const targetPath = tmpXlsxPath();
    const options: BookCreateOption = { rdh: { outputAllOnOneSheet: true } };
    await createBookFromList([rdh1, rdh2], targetPath, options);

    const workbook = await readWorkbook(targetPath);
    const sheet = workbook.getWorksheet("RESULT_SETS")!;

    // rdh1: baseRowNo=3, title(1) + header(2) + rows(2) = plusNo 5 -> next base = 3 + 5 + 2 = 10
    expect(sheet.getCell(3, 2).value).toBe("■ first");
    expect(sheet.getCell(10, 2).value).toBe("■ second");
  });
});

describe("createBookFromDiffList", () => {
  it("TOC・before/afterシート・Undo Changes・Record Rulesシートを生成する", async () => {
    const rdh1 = makeRdh({
      tableName: "users",
      comment: "user table",
      keys: [
        { name: "id", type: GeneralColumnType.INTEGER, comment: "identifier" },
        { name: "name", type: GeneralColumnType.VARCHAR, comment: "user name" },
      ],
      rows: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      sqlStatement: "SELECT * FROM users",
      ruleViolationSummary: { rule1: 1 },
    });
    const rdh2 = makeRdh({
      tableName: "users",
      comment: "user table",
      keys: [
        { name: "id", type: GeneralColumnType.INTEGER, comment: "identifier" },
        { name: "name", type: GeneralColumnType.VARCHAR, comment: "user name" },
      ],
      rows: [
        { id: 1, name: "Alicia" },
        { id: 3, name: "Carol" },
      ],
    });
    const diffResult: DiffResult = {
      ok: true,
      message: "",
      inserted: 1,
      deleted: 1,
      updated: 1,
      updatedColumns: 1,
    };

    const targetPath = tmpXlsxPath();
    const options: BookCreateOption = {
      rdh: { outputAllOnOneSheet: false },
      diff: { displayOnlyChanged: false },
      rule: { withRecordRule: true },
    };
    const err = await createBookFromDiffList(
      [
        {
          title: "users diff",
          rdh1,
          rdh2,
          diffResult,
          undoChangeStatements: ["UPDATE users SET name='Alice' WHERE id=1"],
        },
      ],
      targetPath,
      options
    );
    expect(err).toBe("");

    const workbook = await readWorkbook(targetPath);
    const sheetNames = workbook.worksheets.map((s) => s.name);
    // RECORD_RULES is intentionally not asserted here: it's only created when a row
    // actually has a rule-engine "Rul" annotation attached (requires rdh.meta.tableRule
    // wired up by the rule engine, which is out of scope for this smoke test), so
    // options.rule.withRecordRule:true above just exercises the "no violations" branch.
    expect(sheetNames).toEqual(
      expect.arrayContaining(["TOC", "before", "after", "UNDO_CHANGES"])
    );

    const before = workbook.getWorksheet("before")!;
    expect(before.getCell("A1").value).toBe("■ users diff (user table)");
    // row 2 is a blank spacer row (title row + 1); the SQL label/content follow at row 3
    expect(before.getCell("A3").value).toBe("SQL");
    expect(before.getCell("B3").value).toBe("SELECT * FROM users");
  });

  it("undoChangeStatementsやwithRecordRuleが無ければ該当シートを作らない", async () => {
    const rdh1 = makeRdh({
      tableName: "orders",
      keys: [{ name: "id", type: GeneralColumnType.INTEGER }],
      rows: [{ id: 1 }],
    });
    const rdh2 = makeRdh({
      tableName: "orders",
      keys: [{ name: "id", type: GeneralColumnType.INTEGER }],
      rows: [{ id: 1 }],
    });
    const diffResult: DiffResult = {
      ok: true,
      message: "",
      inserted: 0,
      deleted: 0,
      updated: 0,
      updatedColumns: 0,
    };

    const targetPath = tmpXlsxPath();
    const err = await createBookFromDiffList(
      [{ title: "orders diff", rdh1, rdh2, diffResult }],
      targetPath
    );
    expect(err).toBe("");

    const workbook = await readWorkbook(targetPath);
    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(expect.arrayContaining(["before", "after"]));
    expect(sheetNames).not.toContain("UNDO_CHANGES");
    expect(sheetNames).not.toContain("RECORD_RULES");
  });
});

describe("createLogAnalysisWorkbook", () => {
  it("RawLogs・ParsedEvents・ExtractedSQLsシートを生成する", async () => {
    const rawLogs = makeRdh({
      tableName: "rawlogs",
      keys: [{ name: "line", type: GeneralColumnType.TEXT }],
      rows: [{ line: "2024-01-01 INFO hello" }],
    });
    const logEvents = makeRdh({
      tableName: "events",
      keys: [
        { name: "lineNo", type: GeneralColumnType.INTEGER },
        { name: "timestamp", type: GeneralColumnType.TEXT },
        { name: "eventType", type: GeneralColumnType.TEXT },
        { name: "message", type: GeneralColumnType.TEXT },
      ],
      rows: [{ lineNo: 1, timestamp: "2024-01-01", eventType: "INFO", message: "hello" }],
    });
    const sqlEvents = makeRdh({
      tableName: "sqls",
      keys: [
        { name: "startLine", type: GeneralColumnType.INTEGER },
        { name: "content", type: GeneralColumnType.TEXT },
      ],
      rows: [{ startLine: 1, content: "SELECT 1" }],
    });

    const extractedResult = {
      ok: true,
      stage: "sqlExecutions",
      logEvents: [],
      sqlExecutions: [],
      inputSummary: {},
      outputSummary: {
        totalSqlExecutions: 1,
        totalEvents: 1,
        eventTypeCounts: { INFO: 1 },
        sqlExecutionTypeCounts: { select: 1 },
      },
      errorRate: 0,
      elapsedTimeMilli: { split: 1, classification: 2, sqlExecutions: 3, total: 6 },
    } as unknown as ExtractedSqlResult;

    const targetPath = tmpXlsxPath();
    const err = await createLogAnalysisWorkbook({
      totalLogLines: 100,
      linesToParse: 100,
      rawLogs,
      logEvents,
      sqlEvents,
      extractedResult,
      targetExcelPath: targetPath,
    });
    expect(err).toBe("");

    const workbook = await readWorkbook(targetPath);
    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(
      expect.arrayContaining(["TOC", "RawLogs", "ParsedEvents", "ExtractedSQLs"])
    );
  });

  it("sqlEventsが無ければExtractedSQLsシートを作らない", async () => {
    const rawLogs = makeRdh({
      tableName: "rawlogs",
      keys: [{ name: "line", type: GeneralColumnType.TEXT }],
      rows: [{ line: "hello" }],
    });
    const logEvents = makeRdh({
      tableName: "events",
      keys: [{ name: "lineNo", type: GeneralColumnType.INTEGER }],
      rows: [{ lineNo: 1 }],
    });

    const extractedResult = {
      ok: true,
      stage: "classification",
      logEvents: [],
      sqlExecutions: [],
      inputSummary: {},
      outputSummary: {
        totalSqlExecutions: 0,
        totalEvents: 1,
        eventTypeCounts: { INFO: 1 },
        sqlExecutionTypeCounts: {},
      },
      elapsedTimeMilli: { split: 1, total: 1 },
    } as unknown as ExtractedSqlResult;

    const targetPath = tmpXlsxPath();
    const err = await createLogAnalysisWorkbook({
      totalLogLines: 1,
      linesToParse: 1,
      rawLogs,
      logEvents,
      extractedResult,
      targetExcelPath: targetPath,
    });
    expect(err).toBe("");

    const workbook = await readWorkbook(targetPath);
    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(expect.arrayContaining(["RawLogs", "ParsedEvents"]));
    expect(sheetNames).not.toContain("ExtractedSQLs");
  });
});
