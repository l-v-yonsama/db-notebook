import * as Excel from "exceljs";
import { getOutputConfig } from "../configUtil";
import { setAnyValueByIndex, setTableHeaderCell } from "./cellStyle";
import { TocRecords } from "./common";
import { registerExcelThemeDataRange } from "./excelTheme";

const UNDO_CHANGE_SQL_SHEET_NAME = "UNDO_CHANGES";

type UndoChangeSheetParams = {
  title: string;
  tableName?: string;
  undoChangeStatements: string[];
};

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

    const firstStatementRow = rowNo;
    undoChangeStatements.forEach((statement) => {
      // Rule name
      cell = sheet.getCell(`B${rowNo}`);
      cell.value = `${statement};`;
      rowNo++;
    });
    registerExcelThemeDataRange(sheet, {
      firstRow: firstStatementRow,
      lastRow: rowNo - 1,
      firstCol: 2,
      lastCol: 11,
    });
    rowNo += 2;
  });
  return tocRecords;
}
