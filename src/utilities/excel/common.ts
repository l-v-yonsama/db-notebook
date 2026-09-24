import * as Excel from "exceljs";
import {
  ChangeInNumbersAnnotation,
  CodeResolvedAnnotation,
  ErrorAnnotation,
  FileAnnotation,
  GeneralColumnType,
  RdhKey,
  ResultSetData,
  RowHelper,
  RuleAnnotation,
} from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import { EnumValues } from "enum-values";
import * as os from "os";
import { ResultsetConfigType } from "../../types/Config";
import { getOutputConfig } from "../configUtil";
import {
  addImageInSheet,
  CellStyleOptionsParams,
  fillCell,
  getCellFormat,
  getImageTypeFromContentType,
  setAnyValueByIndex,
  setTableHeaderCell,
  toRuleMarker,
} from "./cellStyle";
import { registerExcelThemeDataRange, registerExcelThemeSqlBlock } from "./excelTheme";

// Shared workbook-level plumbing (TOC record building, the common header block,
// and the single-result-set "table writer" pipeline) reused by both
// rdhWorkbook.ts and logAnalysisWorkbook.ts.

export type TocHeaderCol = {
  label: string;
  key: string;
};

export type TocRecords = {
  headers: TocHeaderCol[];
  records: { [key: string]: Excel.CellValue }[];
};

export type BookCreateOption = {
  rdh: {
    outputAllOnOneSheet: boolean;
  };
  diff?: {
    displayOnlyChanged: boolean;
  };
  rule?: {
    withRecordRule: boolean;
  };
  files?: any[];
  title?: string;
  subTitle?: string;
};

export function columnToLetter(column: number) {
  var temp,
    letter = "";
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

export function createCommonHeader(sheet: Excel.Worksheet) {
  sheet.getCell("A1").value = `Created: ${dayjs().format("YYYY-MM-DD(ddd) HH:mm")}`;
  sheet.getCell("A2").value = `Creator: ${os.userInfo().username}`;
  sheet.mergeCells("A1:J1");
  sheet.mergeCells("A2:J2");
  const headerFill: Excel.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F3F3" },
  };
  for (let row = 1; row <= 2; row++) {
    for (let col = 1; col <= 10; col++) {
      sheet.getCell(row, col).fill = headerFill;
    }
  }
  registerExcelThemeDataRange(sheet, { firstRow: 1, lastRow: 2, firstCol: 1, lastCol: 10 });
  for (const col of ["F", "G", "J"]) {
    sheet.getColumn(col).width = 11;
  }
}

export function writeTocRecords(tocSheet: Excel.Worksheet, tocRecords: TocRecords, rowNo: number): number {
  let plusNo = 0;
  tocRecords.headers.forEach((header, idx) => {
    const cell = tocSheet.getCell(rowNo + plusNo, 3 + idx);
    setTableHeaderCell(cell);
    cell.value = header.label;
  });
  plusNo++;

  tocRecords.records.forEach((record) => {
    tocRecords.headers.forEach((header, idx) => {
      const cell = tocSheet.getCell(rowNo + plusNo, 3 + idx);
      cell.value = record[header.key];
    });
    plusNo++;
  });

  registerExcelThemeDataRange(tocSheet, {
    firstRow: rowNo + 1,
    lastRow: rowNo + tocRecords.records.length,
    firstCol: 3,
    lastCol: 2 + tocRecords.headers.length,
  });

  return plusNo;
}

export function createQueryResultSheet(
  book: Excel.Workbook,
  sheet: Excel.Worksheet,
  rdh: ResultSetData,
  baseRowNo: number,
  rdhConfig: ResultsetConfigType,
  options?: {
    sqlStatementLabel?: string;
    adjustRow?: {
      maxRowCount: number;
      calcKeys: string[];
    };
  }
): number {
  let plusNo = 0;
  const outputCondig = getOutputConfig();

  if (outputCondig.excel.displayTableNameAndStatement) {
    plusNo += writeTitleAndSqlStatementSection(sheet, rdh, baseRowNo + plusNo, {
      sqlStatementLabel: options?.sqlStatementLabel,
    });
  }

  if (rdh.meta.ruleViolationSummary) {
    plusNo += writeRuleViolationSummarySection(
      sheet,
      rdh.meta.ruleViolationSummary,
      baseRowNo + plusNo
    );
  }

  plusNo += writeHeaderSection(sheet, rdh, baseRowNo + plusNo, rdhConfig);

  plusNo += writeDataRowsSection(book, sheet, rdh, baseRowNo + plusNo, rdhConfig, options);

  return plusNo;
}

function writeTitleAndSqlStatementSection(
  sheet: Excel.Worksheet,
  rdh: ResultSetData,
  baseRowNo: number,
  options?: {
    sqlStatementLabel?: string;
  }
): number {
  let plusNo = 0;
  const { tableName, comment } = rdh.meta;

  let cell = sheet.getCell(baseRowNo, 2);
  let titleValue = tableName;
  if (comment) {
    titleValue += ` (${comment})`;
  }
  cell.value = "■ " + titleValue;
  plusNo++;

  // sql statement
  if (rdh.sqlStatement) {
    plusNo++;
    const lines = rdh.sqlStatement
      .trim()
      .replace(/\r\n|\r/g, "\n")
      .split("\n");
    const firstSqlRow = baseRowNo + plusNo;
    cell = sheet.getCell(baseRowNo + plusNo, 2);
    cell.value = options?.sqlStatementLabel ? options.sqlStatementLabel : "SQL";
    setTableHeaderCell(cell);
    sheet.mergeCells(`B${baseRowNo + plusNo}:B${baseRowNo + plusNo + lines.length - 1}`);
    lines.forEach((line) => {
      cell = sheet.getCell(baseRowNo + plusNo, 3);
      cell.value = line;
      plusNo++;
    });
    registerExcelThemeSqlBlock(sheet, {
      headingRow: baseRowNo,
      firstRow: firstSqlRow,
      lastRow: baseRowNo + plusNo - 1,
      firstCol: 2,
    });
    if (rdh.queryConditions?.binds && rdh.queryConditions?.binds.length > 0) {
      cell = sheet.getCell(baseRowNo + plusNo, 2);
      cell.value = "BINDS";
      setTableHeaderCell(cell);
      // テーブル見出しの行分もマージするので -1 は不要
      sheet.mergeCells(
        `B${baseRowNo + plusNo}:B${baseRowNo + plusNo + rdh.queryConditions?.binds.length}`
      );

      cell = sheet.getCell(baseRowNo + plusNo, 3);
      cell.value = "Position";
      setTableHeaderCell(cell);
      cell = sheet.getCell(baseRowNo + plusNo, 4);
      cell.value = "Value";
      setTableHeaderCell(cell);
      plusNo++;
      rdh.queryConditions?.binds.forEach((v, idx) => {
        cell = sheet.getCell(baseRowNo + plusNo, 3);
        cell.value = `$${idx + 1}`;
        cell = sheet.getCell(baseRowNo + plusNo, 4);
        cell.value = v;
        plusNo++;
      });
    }
    plusNo++;
  }

  return plusNo;
}

function writeRuleViolationSummarySection(
  sheet: Excel.Worksheet,
  ruleViolationSummary: Record<string, number>,
  baseRowNo: number
): number {
  let plusNo = 0;
  const names = Object.keys(ruleViolationSummary);
  let cell = sheet.getCell(baseRowNo, 2);
  setTableHeaderCell(cell);
  if (names.length === 1) {
    cell.value = `Rule violation`;
    sheet.mergeCells(`B${baseRowNo}:C${baseRowNo}`);
  } else {
    cell.value = `Rule violations`;
    sheet.mergeCells(`B${baseRowNo}:C${baseRowNo + names.length - 1}`);
  }
  names.forEach((name, idx) => {
    cell = sheet.getCell(baseRowNo + plusNo, 4);
    cell.value = `*${idx + 1}: ${name}: ${ruleViolationSummary[name]}`;
    plusNo++;
  });
  plusNo++;

  return plusNo;
}

function writeHeaderSection(
  sheet: Excel.Worksheet,
  rdh: ResultSetData,
  baseRowNo: number,
  rdhConfig: ResultsetConfigType
): number {
  let plusNo = 0;
  const { displayRowno } = rdhConfig;

  if (displayRowno) {
    const cell = sheet.getCell(baseRowNo, 2);
    cell.value = "No";
    setTableHeaderCell(cell);
  }

  rdh.keys.forEach((column: RdhKey, idx: number) => {
    let colBasePos = displayRowno ? 3 : 2;
    const cellPhy = sheet.getCell(baseRowNo, colBasePos + idx);
    cellPhy.value = column.name;
    setTableHeaderCell(cellPhy);

    if (rdhConfig.header.displayComment) {
      const cellLog = sheet.getCell(baseRowNo + 1, colBasePos + idx);
      cellLog.value = column.comment;
      setTableHeaderCell(cellLog);
    }
    if (rdhConfig.header.displayType) {
      const cellType = sheet.getCell(
        baseRowNo + (rdhConfig.header.displayComment ? 2 : 1),
        colBasePos + idx
      );
      cellType.value = EnumValues.getNameFromValue(GeneralColumnType, column.type);
      setTableHeaderCell(cellType);
    }
  });
  if (rdhConfig.header.displayComment && rdhConfig.header.displayType) {
    if (displayRowno) {
      sheet.mergeCells(`B${baseRowNo}:B${baseRowNo + 2}`);
    }
    plusNo += 3;
  } else if (rdhConfig.header.displayComment || rdhConfig.header.displayType) {
    if (displayRowno) {
      sheet.mergeCells(`B${baseRowNo}:B${baseRowNo + 1}`);
    }
    plusNo += 2;
  } else {
    plusNo += 1;
  }

  return plusNo;
}

function writeDataRowsSection(
  book: Excel.Workbook,
  sheet: Excel.Worksheet,
  rdh: ResultSetData,
  baseRowNo: number,
  rdhConfig: ResultsetConfigType,
  options?: {
    adjustRow?: {
      maxRowCount: number;
      calcKeys: string[];
    };
  }
): number {
  let plusNo = 0;
  const { displayRowno } = rdhConfig;
  const { ruleViolationSummary } = rdh.meta;

  if (rdh.rows.length > 0) {
    registerExcelThemeDataRange(sheet, {
      firstRow: baseRowNo,
      lastRow: baseRowNo + rdh.rows.length - 1,
      firstCol: 2,
      lastCol: (displayRowno ? 2 : 1) + rdh.keys.length,
    });
    rdh.rows.forEach((rdhRow, ri: number) => {
      const values = rdhRow.values;
      if (displayRowno) {
        sheet.getCell(baseRowNo + plusNo, 2).value = ri + 1;
      }
      if (options?.adjustRow) {
        const { calcKeys, maxRowCount } = options.adjustRow;
        const rowCount = calcMaxRowCount(values, calcKeys, maxRowCount);
        sheet.getRow(baseRowNo + plusNo).height = rowCount * 15;
      }
      rdh.keys.forEach((column: RdhKey, colIdx: number) => {
        let colBasePos = displayRowno ? 3 : 2;
        let ruleMarker: string | undefined = undefined;
        let resolvedLabel: string | undefined = undefined;

        const v = values[column.name];

        const fileAnnonation = RowHelper.getFirstAnnotationOf<FileAnnotation>(
          rdhRow,
          column.name,
          "Fil"
        );
        if (fileAnnonation) {
          const { values } = fileAnnonation;
          if (
            (values?.size ?? 0) > 0 &&
            values?.contentTypeInfo.renderType === "Image" &&
            v &&
            getImageTypeFromContentType(values.contentTypeInfo.contentType) !== undefined
          ) {
            const base64 = v;
            const extension = getImageTypeFromContentType(values.contentTypeInfo.contentType)!;
            addImageInSheet(book, sheet, base64, extension, {
              tl: { col: colBasePos + colIdx - 1, row: baseRowNo + plusNo - 1 },
              br: { col: colBasePos + colIdx, row: baseRowNo + plusNo },
            } as any);
          } else {
            const cell = sheet.getCell(baseRowNo + plusNo, colBasePos + colIdx);
            setAnyValueByIndex(cell, values?.downloadUrl, { isHyperText: true });
          }
        } else {
          const ruleAnnonations = RowHelper.filterAnnotationByKeyOf<RuleAnnotation>(
            rdhRow,
            column.name,
            "Rul"
          );
          let format = getCellFormat(column.type);
          const cell = sheet.getCell(baseRowNo + plusNo, colBasePos + colIdx);
          let isHyperText = column.meta && column.meta.is_hyperlink === true;
          if (ruleAnnonations.length) {
            ruleMarker = toRuleMarker(ruleViolationSummary, ruleAnnonations);
            fillCell(cell, "Rul");
          }
          if (
            RowHelper.filterAnnotationByKeyOf<ErrorAnnotation>(rdhRow, column.name, "Err").length
          ) {
            fillCell(cell, "Err");
          }
          if (rdh.meta.codeItems) {
            resolvedLabel = RowHelper.getFirstAnnotationOf<CodeResolvedAnnotation>(
              rdhRow,
              column.name,
              "Cod"
            )?.values?.label;
          }
          // ChangeInNumbersAnnotation
          const cinAnnotation = RowHelper.getFirstAnnotationOf<ChangeInNumbersAnnotation>(
            rdhRow,
            column.name,
            "Cin"
          );
          if (cinAnnotation && cinAnnotation.values?.value) {
            resolvedLabel =
              (cinAnnotation.values?.value >= 0 ? " +" : " ") + cinAnnotation.values?.value;
          }

          const styleOptions: CellStyleOptionsParams = {
            isHyperText,
            format,
            ruleMarker,
            resolvedLabel,
          };
          if (options?.adjustRow) {
            styleOptions.wrap = true;
          }
          setAnyValueByIndex(cell, v, styleOptions);
        }
      });
      plusNo++;
    });
  } else {
    sheet.getCell(baseRowNo + plusNo, 2).value = "No records.";
    plusNo++;
  }

  return plusNo;
}

function calcMaxRowCount(values: Record<string, any>, calcKeys: string[], maxLines: number) {
  let calcMaxLineCount = 1;
  if (calcKeys.length > 0) {
    calcKeys.forEach((calcKey) => {
      const v = values[calcKey];
      if (v) {
        const lines = `${v}`.split(/\r\n|\r|\n/).length;
        calcMaxLineCount = Math.max(lines, calcMaxLineCount);
      }
    });
  }

  return Math.min(calcMaxLineCount, maxLines);
}

async function createFileSheet(workbook: Excel.Workbook, sheetName: string, file: any) {
  var sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  sheet.getCell(`A1`).value = { text: "Back to TOC", hyperlink: `#TOC!A1` };
  sheet.mergeCells("A1:C1");

  sheet.getColumn("B").width = 50;
  sheet.getColumn("C").width = 50;

  sheet.getRow(4).height = 90;
  sheet.getRow(5).height = 90;
  sheet.getRow(6).height = 90;
  sheet.getRow(7).height = 90;

  addImageInSheet(workbook, sheet, file.image_base64, "jpeg", {
    tl: { col: 1.1, row: 4.1 },
    br: { col: 4, row: 5 },
  } as any);
}

function convertNotNaN(v: number) {
  return isNaN(v) ? "-" : v;
}
