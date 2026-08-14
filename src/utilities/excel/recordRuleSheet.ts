import { RecordRuleValidationResult } from "@l-v-yonsama/rdh";
import * as Excel from "exceljs";
import { getOutputConfig } from "../configUtil";
import { setAnyValueByIndex, setTableHeaderCell } from "./cellStyle";
import { TocRecords } from "./common";

const RECORD_RULE_SHEET_NAME = "RECORD_RULES";

const UNDO_CHANGE_SQL_SHEET_NAME = "UNDO_CHANGES";

type UndoChangeSheetParams = {
  title: string;
  tableName?: string;
  undoChangeStatements: string[];
};

export function createRecordRulesSheet(
  workbook: Excel.Workbook,
  list: RecordRuleValidationResult[]
): TocRecords {
  const outputCondig = getOutputConfig();
  const tocRecords: TocRecords = {
    headers: [
      { label: "No", key: "no" },
      { label: "TABLE NAME", key: "tableName" },
      { label: "RULE NAME", key: "ruleName" },
      { label: "ERRORS", key: "errors" },
    ],
    records: [],
  };
  var sheet = workbook.addWorksheet(RECORD_RULE_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  if (outputCondig.excel.displayToc) {
    const cell = sheet.getCell(`A1`);
    setAnyValueByIndex(cell, "Back to TOC", { isHyperText: true, hyperLinkAddr: "#TOC!A1" });
  }
  sheet.mergeCells("A1:C1");
  sheet.autoFilter = "B3:D3";
  sheet.getColumn("A").width = 2;
  sheet.getColumn("B").width = 12;
  sheet.getColumn("C").width = 6;
  sheet.getColumn("D").width = 8;
  sheet.getColumn("E").width = 50;

  let cell: any;
  let rowNo = 3;
  let tocRecordNo = 1;
  list.forEach((result) => {
    result.details.forEach((detail) => {
      // Table name
      cell = sheet.getCell(`B${rowNo}`);
      setTableHeaderCell(cell);
      cell.value = "Table name";
      cell = sheet.getCell(`C${rowNo}`);
      cell.value = result.tableName;
      rowNo++;
      // Rule name
      cell = sheet.getCell(`B${rowNo}`);
      setTableHeaderCell(cell);
      cell.value = "Rule name";
      cell = sheet.getCell(`C${rowNo}`);
      cell.value = detail.ruleDetail.ruleName;

      tocRecords.records.push({
        no: tocRecordNo++,
        tableName: result.tableName,
        ruleName: {
          text: detail.ruleDetail.ruleName,
          hyperlink: `#${sheet.name}!B${rowNo}`,
        },
        errors: detail.errorRows.length,
      });

      rowNo++;

      // Conditions
      cell = sheet.getCell(`B${rowNo}`);
      setTableHeaderCell(cell);
      cell.value = "Rule conditions";
      const texts = detail.conditionText.trim().split("\n");
      sheet.mergeCells(`B${rowNo}:B${rowNo + texts.length}`);

      texts.forEach((text) => {
        cell = sheet.getCell(`C${rowNo}`);
        cell.value = text;
        rowNo++;
      });

      rowNo += 2;

      // error headers
      cell = sheet.getCell(`C${rowNo}`);
      cell.value = "No";
      setTableHeaderCell(cell);
      cell = sheet.getCell(`D${rowNo}`);
      cell.value = "RowNo";
      setTableHeaderCell(cell);
      cell = sheet.getCell(`E${rowNo}`);
      cell.value = "Condition values";
      setTableHeaderCell(cell);
      rowNo++;
      detail.errorRows.forEach((errorRow, idx) => {
        cell = sheet.getCell(`C${rowNo}`).value = idx + 1;
        cell = sheet.getCell(`D${rowNo}`).value = errorRow.rowNo;
        cell = sheet.getCell(`E${rowNo}`).value = JSON.stringify(errorRow.conditionValues);
        rowNo++;
      });
      rowNo += 2;
    });
    rowNo += 3;
  });
  return tocRecords;
}

export function createUndoChangeSheet(
  workbook: Excel.Workbook,
  list: UndoChangeSheetParams[]
): TocRecords {
  const outputCondig = getOutputConfig();
  const tocRecords: TocRecords = {
    headers: [
      { label: "No", key: "no" },
      { label: "TABLE NAME", key: "tableName" },
      { label: "NUMBER OF STATEMENTS", key: "numOfStatements" },
    ],
    records: [],
  };
  var sheet = workbook.addWorksheet(UNDO_CHANGE_SQL_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  if (outputCondig.excel.displayToc) {
    const cell = sheet.getCell(`A1`);
    setAnyValueByIndex(cell, "Back to TOC", { isHyperText: true, hyperLinkAddr: "#TOC!A1" });
  }
  sheet.mergeCells("A1:C1");
  sheet.getColumn("A").width = 2;
  sheet.getColumn("B").width = 12;
  sheet.getColumn("C").width = 8;

  let cell: any;
  let rowNo = 3;

  list.forEach((it, idx) => {
    const { title, tableName, undoChangeStatements } = it;

    tocRecords.records.push({
      no: idx + 1,
      tableName: {
        text: tableName ?? "-",
        hyperlink: `#${UNDO_CHANGE_SQL_SHEET_NAME}!B${rowNo}`,
      },
      numOfStatements: undoChangeStatements.length,
    });

    // Table name
    cell = sheet.getCell(`B${rowNo}`);
    setTableHeaderCell(cell);
    cell.value = `-- ${idx + 1}:${tableName}`;
    // only setting cell style.
    cell = sheet.getCell(`C${rowNo}`);
    setTableHeaderCell(cell);
    cell = sheet.getCell(`D${rowNo}`);
    setTableHeaderCell(cell);

    rowNo++;

    undoChangeStatements.forEach((statement) => {
      // Rule name
      cell = sheet.getCell(`B${rowNo}`);
      cell.value = `${statement};`;
      rowNo++;
    });
    rowNo += 2;
  });
  return tocRecords;
}

