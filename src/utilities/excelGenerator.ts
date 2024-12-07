import { getRecordRuleResults } from "@l-v-yonsama/multi-platform-database-drivers";
import {
  AnnotationType,
  ChangeInNumbersAnnotation,
  CodeResolvedAnnotation,
  DiffResult,
  FileAnnotation,
  GeneralColumnType,
  RdhKey,
  RdhMeta,
  RecordRuleValidationResult,
  ResultSetData,
  ResultSetDataBuilder,
  RowHelper,
  RuleAnnotation,
  UpdateAnnotation,
  isDateTimeOrDate,
  toDate,
} from "@l-v-yonsama/rdh";
import * as dayjs from "dayjs";
import { EnumValues } from "enum-values";
import * as Excel from "exceljs";
import { Fill } from "exceljs";
import * as os from "os";
import { getOutputConfig, getResultsetConfig } from "./configUtil";

// const FONT_NAME_Arial ='Arial';
const FONT_NAME_Comic_Sans_MS = "Comic Sans MS";

const RECORD_RULE_SHEET_NAME = "RECORD_RULES";

const UNDO_CHANGE_SQL_SHEET_NAME = "UNDO_CHANGES";

interface IHyperLink {
  title: string;
  address: string;
}

type UndoChangeSheetParams = {
  title: string;
  tableName?: string;
  undoChangeStatements: string[];
};

type TocHeaderCol = {
  label: string;
  key: string;
};

type TocRecords = {
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

export { columnToLetter, createBookFromDiffList, createBookFromList, createBookFromRdh };

function columnToLetter(column: number) {
  var temp,
    letter = "";
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

function stripSheetName(s: string): string {
  return s.replace(/['*\/:\?\[\\\]’＇*／：？［＼］￥]+/g, "");
}

function createQueryResultListSheet(
  workbook: Excel.Workbook,
  list: ResultSetData[],
  options?: BookCreateOption
): TocRecords {
  const tocRecords: TocRecords = {
    headers: [
      { label: "No", key: "no" },
      { label: "TITLE(TABLE)", key: "tableName" },
      { label: "COMMENT", key: "comment" },
      { label: "TYPE", key: "type" },
      { label: "ROWS", key: "rows" },
      { label: "ELAPSED TIME", key: "time" },
    ],
    records: [],
  };

  if (options?.rdh.outputAllOnOneSheet) {
    let baseRowNo = 3;
    const sheetName = createSheetName("RESULT_SETS");
    var sheet = workbook.addWorksheet(sheetName, {
      pageSetup: { paperSize: 9, orientation: "portrait" },
    });
    sheet.getColumn("A").width = 2;
    list.forEach((rdh, idx) => {
      let time = "-";
      if (rdh.summary?.elapsedTimeMilli !== undefined) {
        time = (rdh.summary.elapsedTimeMilli / 1000).toFixed(2) + " sec";
      }
      tocRecords.records.push({
        no: idx + 1,
        tableName: {
          text: rdh.meta.tableName ?? "-",
          hyperlink: `#${sheetName}!B${baseRowNo}`,
        },
        comment: rdh.meta.comment,
        type: rdh.meta.type,
        rows: rdh.meta.type === "select" ? rdh.rows.length : "-",
        time,
      });
      const plusRows = createQueryResultSheet(workbook, sheet, rdh, baseRowNo);
      baseRowNo += plusRows + 2;
    });
  } else {
    list.forEach((rdh, idx) => {
      const baseRowNo = 3;
      const sheetName = createSheetName(rdh, idx + 1);
      tocRecords.records.push({
        no: idx + 1,
        tableName: {
          text: sheetName,
          hyperlink: `#${sheetName}!A${baseRowNo}`,
        },
        comment: rdh.meta.comment,
        type: rdh.meta.type,
        rows: rdh.meta.type === "select" ? rdh.rows.length : "-",
      });

      var sheet = workbook.addWorksheet(sheetName, {
        views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
        pageSetup: { paperSize: 9, orientation: "portrait" },
      });
      sheet.getColumn("A").width = 2;
      createQueryResultSheet(workbook, sheet, rdh, baseRowNo);
    });
  }

  return tocRecords;
}

function createQueryResultSheet(
  book: Excel.Workbook,
  sheet: Excel.Worksheet,
  rdh: ResultSetData,
  baseRowNo: number
): number {
  let plusNo = 0;
  const rdhConfig = getResultsetConfig();
  const outputCondig = getOutputConfig();

  const { tableName, comment, ruleViolationSummary } = rdh.meta;
  // table name / comment
  let cell = sheet.getCell(baseRowNo, 2);
  let titleValue = tableName;
  if (comment) {
    titleValue += ` (${comment})`;
  }
  if (outputCondig.excel.displayTableNameAndStatement) {
    cell.value = "■ " + titleValue;
    plusNo++;

    // sql statement
    if (rdh.sqlStatement) {
      plusNo++;
      const lines = rdh.sqlStatement.trim().replace(/\r\n/g, "\n").split("\n");
      cell = sheet.getCell(baseRowNo + plusNo, 2);
      cell.value = "SQL";
      setTableHeaderCell(cell);
      sheet.mergeCells(`B${baseRowNo + plusNo}:B${baseRowNo + plusNo + lines.length - 1}`);
      lines.forEach((line) => {
        cell = sheet.getCell(baseRowNo + plusNo, 3);
        cell.value = line;
        plusNo++;
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
  }

  if (ruleViolationSummary) {
    const names = Object.keys(ruleViolationSummary);
    cell = sheet.getCell(baseRowNo + plusNo, 2);
    setTableHeaderCell(cell);
    if (names.length === 1) {
      cell.value = `Rule violation`;
      sheet.mergeCells(`B${baseRowNo + plusNo}:C${baseRowNo + plusNo}`);
    } else {
      cell.value = `Rule violations`;
      sheet.mergeCells(`B${baseRowNo + plusNo}:C${baseRowNo + plusNo + names.length - 1}`);
    }
    names.forEach((name, idx) => {
      cell = sheet.getCell(baseRowNo + plusNo, 4);
      cell.value = `*${idx + 1}: ${name}: ${ruleViolationSummary[name]}`;
      plusNo++;
    });
    plusNo++;
  }

  // resulet set
  const { displayRowno } = rdhConfig;

  if (displayRowno) {
    cell = sheet.getCell(baseRowNo + plusNo, 2);
    cell.value = "No";
    setTableHeaderCell(cell);
  }

  rdh.keys.forEach((column: RdhKey, idx: number) => {
    let colBasePos = displayRowno ? 3 : 2;
    const cellPhy = sheet.getCell(baseRowNo + plusNo, colBasePos + idx);
    cellPhy.value = column.name;
    setTableHeaderCell(cellPhy);

    if (rdhConfig.header.displayComment) {
      const cellLog = sheet.getCell(baseRowNo + plusNo + 1, colBasePos + idx);
      cellLog.value = column.comment;
      setTableHeaderCell(cellLog);
    }
    if (rdhConfig.header.displayType) {
      const cellType = sheet.getCell(
        baseRowNo + plusNo + (rdhConfig.header.displayComment ? 2 : 1),
        colBasePos + idx
      );
      cellType.value = EnumValues.getNameFromValue(GeneralColumnType, column.type);
      setTableHeaderCell(cellType);
    }
  });
  if (rdhConfig.header.displayComment && rdhConfig.header.displayType) {
    if (displayRowno) {
      sheet.mergeCells(`B${baseRowNo + plusNo}:B${baseRowNo + plusNo + 2}`);
    }
    plusNo += 3;
  } else if (rdhConfig.header.displayComment || rdhConfig.header.displayType) {
    if (displayRowno) {
      sheet.mergeCells(`B${baseRowNo + plusNo}:B${baseRowNo + plusNo + 1}`);
    }
    plusNo += 2;
  } else {
    plusNo += 1;
  }

  if (rdh.rows.length > 0) {
    rdh.rows.forEach((rdhRow, ri: number) => {
      const values = rdhRow.values;
      if (displayRowno) {
        sheet.getCell(baseRowNo + plusNo, 2).value = ri + 1;
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

          setAnyValueByIndex(cell, v, { isHyperText, format, ruleMarker, resolvedLabel });
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

function createSheetName(o: ResultSetData | string, no?: number): string {
  const title = typeof o === "string" ? o : (o as ResultSetData).meta?.tableName ?? "";
  if (no !== undefined) {
    return stripSheetName(`${no}_${title}`);
  }
  return stripSheetName(title);
}

async function createBookFromRdh(rdh: ResultSetData, targetExcelPath: string): Promise<string> {
  let errorMessage = "";
  var workbook = new Excel.Workbook();
  const sheetName = createSheetName("RESULT_SETS");
  var sheet = workbook.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  createQueryResultSheet(workbook, sheet, rdh, 1);

  return new Promise<string>((resolve, reject) => {
    try {
      workbook.xlsx.writeFile(targetExcelPath).then(function () {
        resolve(errorMessage);
      });
    } catch (e) {
      if (e instanceof Error) {
        reject(e.message);
      } else {
        reject("Error:" + e);
      }
    }
  });
}
async function createBookFromList(
  list: ResultSetData[],
  targetExcelPath: string,
  options?: BookCreateOption
): Promise<string> {
  let errorMessage = "";
  var workbook = new Excel.Workbook();
  const outputCondig = getOutputConfig();

  try {
    // TOC
    let tocSheet: Excel.Worksheet | undefined = undefined;
    if (outputCondig.excel.displayToc) {
      tocSheet = workbook.addWorksheet("TOC", {
        pageSetup: {
          paperSize: 9,
          orientation: "portrait",
          margins: {
            left: 0.5,
            right: 0.5,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
          },
        },
      });
      createCommonHeader(tocSheet);
      tocSheet.getColumn("A").width = 2;
      tocSheet.getColumn("B").width = 2;
      tocSheet.getColumn("C").width = 4;
      tocSheet.getColumn("D").width = 20;
      tocSheet.getColumn("E").width = 16;
    }

    let tocRowNo = 3;
    let cell: Excel.Cell;
    if (outputCondig.excel.displayToc) {
      cell = tocSheet!.getCell(`C${tocRowNo}`);
      cell.value = "Table of contents.";
      cell.font = { name: FONT_NAME_Comic_Sans_MS, size: 24 };
    }

    tocRowNo += 4;

    const generalList = list.filter(
      (it) => !ResultSetDataBuilder.from(it).hasAnyAnnotation(["Lnt"])
    );
    // RESULTSETS
    if (outputCondig.excel.displayToc) {
      cell = tocSheet!.getCell(`C${tocRowNo}`);
      cell.value = "■ Resultsets";
    }
    tocRowNo++;
    const tocRecords = createQueryResultListSheet(workbook, generalList, options);
    if (outputCondig.excel.displayToc) {
      tocRowNo += writeTocRecords(tocSheet!, tocRecords, tocRowNo);
    }

    tocRowNo += 2;

    // RECORD RULES
    const ruleResultList = generalList
      .map((rdh) => getRecordRuleResults(rdh))
      .filter((it) => it !== undefined) as RecordRuleValidationResult[];
    if (ruleResultList.length) {
      if (outputCondig.excel.displayToc) {
        cell = tocSheet!.getCell(`C${tocRowNo}`);
        cell.value = "■ Record Rules";
      }
      tocRowNo++;
      // create a sheet.
      const tocRecords = createRecordRulesSheet(workbook, ruleResultList);
      if (outputCondig.excel.displayToc) {
        tocRowNo += writeTocRecords(tocSheet!, tocRecords, tocRowNo);
      }
    }
  } catch (e) {
    console.error(e);
  }

  return new Promise<string>((resolve, reject) => {
    try {
      workbook.xlsx.writeFile(targetExcelPath).then(function () {
        resolve(errorMessage);
      });
    } catch (e) {
      if (e instanceof Error) {
        reject(e.message);
      } else {
        reject("Error:" + e);
      }
    }
  });
}

function getImageTypeFromContentType(
  contentType: string | undefined
): "jpeg" | "png" | "gif" | undefined {
  if (contentType === undefined) {
    return undefined;
  }
  switch (contentType.toLocaleLowerCase()) {
    case "image/jpg":
    case "image/jpeg":
      return "jpeg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
  }
  return undefined;
}

function createCommonHeader(sheet: Excel.Worksheet) {
  sheet.getCell("A1").value = `Created: ${dayjs().format("YYYY-MM-DD(ddd) HH:mm")}`;
  sheet.getCell("A2").value = `Creator: ${os.userInfo().username}`;
}

/**
 *  DIFF
 */
async function createBookFromDiffList(
  list: {
    title: string;
    rdh1: ResultSetData;
    rdh2: ResultSetData;
    diffResult: DiffResult;
    undoChangeStatements?: string[];
  }[],
  targetExcelPath: string,
  options?: BookCreateOption
): Promise<string> {
  let errorMessage = "";
  var workbook = new Excel.Workbook();
  const displayOnlyChanged = options?.diff?.displayOnlyChanged === true;
  const rdhConfig = getResultsetConfig();
  const outputCondig = getOutputConfig();

  try {
    // TOC
    let tocSheet: Excel.Worksheet | undefined = undefined;
    if (outputCondig.excel.displayToc) {
      tocSheet = workbook.addWorksheet("TOC", {
        pageSetup: {
          paperSize: 9,
          orientation: "portrait",
          margins: {
            left: 0.5,
            right: 0.5,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
          },
        },
      });
      createCommonHeader(tocSheet);
      tocSheet.getColumn("A").width = 2;
      tocSheet.getColumn("B").width = 2;
      tocSheet.getColumn("C").width = 4;
      tocSheet.getColumn("D").width = 20;
      tocSheet.getColumn("E").width = 16;
    }

    let tocRowNo = 3;
    let cell: Excel.Cell;
    if (outputCondig.excel.displayToc) {
      cell = tocSheet!.getCell(`C${tocRowNo}`);
      cell.value = "Table of contents.";
      cell.font = { name: FONT_NAME_Comic_Sans_MS, size: 24 };
    }

    tocRowNo += 4;

    // RESULTSETS
    const diffList = list;
    const beforeSheet = workbook.addWorksheet("before", {
      pageSetup: { paperSize: 9, orientation: "portrait" },
    });
    const afterSheet = workbook.addWorksheet("after", {
      pageSetup: { paperSize: 9, orientation: "portrait" },
    });

    let pairList: {
      rowNo: number;
      rdh: ResultSetData | undefined;
      sheet: Excel.Worksheet;
      tableRowNoList: number[];
    }[] = [
      { rowNo: 1, rdh: undefined, sheet: beforeSheet, tableRowNoList: [] },
      { rowNo: 1, rdh: undefined, sheet: afterSheet, tableRowNoList: [] },
    ];

    const beforeDate = diffList.map((it) => it.rdh1.created).find((it) => it !== undefined);
    const afterDate = diffList.map((it) => it.rdh2.created).find((it) => it !== undefined);

    if (outputCondig.excel.displayToc) {
      tocSheet!.getCell("H4").value = "Before time:";
      tocSheet!.getCell("H4").alignment = {
        horizontal: "right",
      };
      tocSheet!.mergeCells("H4:I4");
      tocSheet!.getCell("H5").value = "After  time:";
      tocSheet!.getCell("H5").alignment = {
        horizontal: "right",
      };
      tocSheet!.mergeCells("H5:I5");
      tocSheet!.getCell("J4").value = `${dayjs(beforeDate).format("HH:mm:ss")}`;
      tocSheet!.getCell("J5").value = `${dayjs(afterDate).format("HH:mm:ss")}`;

      // RESULTSETS
      cell = tocSheet!.getCell(`C${tocRowNo}`);
      cell.value = "■ Resultsets";
      tocRowNo++;
      // header
      [
        "No",
        "Title(Table)",
        "comment",
        "Inserted",
        "Deleted",
        "Updated",
        "Link to",
        "Link to",
      ].forEach((title, idx) => {
        const cell = tocSheet!.getCell(tocRowNo, 3 + idx);
        cell.value = title;
        setTableHeaderCell(cell);
      });
      tocSheet!.mergeCells(`I${tocRowNo}:J${tocRowNo}`);

      tocRowNo++;
    }

    diffList.forEach((item, idx) => {
      const no = idx + 1;
      const { rdh1, rdh2, title, diffResult } = item;
      pairList[0].rdh = rdh1;
      pairList[1].rdh = rdh2;

      if (outputCondig.excel.displayToc) {
        tocSheet!.getCell(`C${tocRowNo}`).value = no;
        tocSheet!.getCell(`D${tocRowNo}`).value = title;
        tocSheet!.getCell(`E${tocRowNo}`).value = rdh1.meta.comment ?? "";
        tocSheet!.getCell(`F${tocRowNo}`).value = diffResult.inserted;
        tocSheet!.getCell(`G${tocRowNo}`).value = diffResult.deleted;
        tocSheet!.getCell(`H${tocRowNo}`).value = diffResult.updated;

        tocSheet!.getCell(`I${tocRowNo}`).value = {
          text: "Before" + no,
          hyperlink: `#before!A${pairList[0].rowNo}`,
        };
        tocSheet!.getCell(`J${tocRowNo}`).value = {
          text: "After" + no,
          hyperlink: `#after!A${pairList[1].rowNo}`,
        };
        tocRowNo += 1;
      }

      // create a sheet.
      for (const cur of pairList) {
        const { sheet, rdh } = cur;
        if (!rdh) {
          continue;
        }
        const { tableName, comment, ruleViolationSummary } = rdh.meta;

        cur.tableRowNoList.push(cur.rowNo);
        if (outputCondig.excel.displayTableNameAndStatement) {
          // table name
          const cellTitle = sheet.getCell(cur.rowNo, 1);
          let titleValue = title;
          if (comment) {
            titleValue += ` (${comment})`;
          }
          if (diffResult.message) {
            titleValue += ` [${diffResult.message}]`;
          }
          cellTitle.value = "■ " + titleValue;
          cur.rowNo++;

          // sql statement
          if (rdh.sqlStatement) {
            cur.rowNo++;
            const lines = rdh.sqlStatement.trim().replace(/\r\n/g, "\n").split("\n");
            cell = sheet.getCell(cur.rowNo, 1);
            cell.value = "SQL";
            setTableHeaderCell(cell);
            sheet.mergeCells(`A${cur.rowNo}:A${cur.rowNo + lines.length - 1}`);
            lines.forEach((line) => {
              cell = sheet.getCell(cur.rowNo, 2);
              cell.value = line;
              cur.rowNo++;
            });
            if (rdh.queryConditions?.binds && rdh.queryConditions?.binds.length > 0) {
              cell = sheet.getCell(cur.rowNo, 1);
              cell.value = "BINDS";
              setTableHeaderCell(cell);
              // テーブル見出しの行分もマージするので -1 は不要
              sheet.mergeCells(`A${cur.rowNo}:A${cur.rowNo + rdh.queryConditions?.binds.length}`);

              cell = sheet.getCell(cur.rowNo, 2);
              cell.value = "Position";
              setTableHeaderCell(cell);
              cell = sheet.getCell(cur.rowNo, 3);
              cell.value = "Value";
              setTableHeaderCell(cell);
              cur.rowNo++;
              rdh.queryConditions?.binds.forEach((v, idx) => {
                cell = sheet.getCell(cur.rowNo, 2);
                cell.value = `$${idx + 1}`;
                cell = sheet.getCell(cur.rowNo, 3);
                cell.value = v;
                cur.rowNo++;
              });
            }
            cur.rowNo++;
          }
        } else {
          cur.rowNo++; // for Link to before/after sheet space
        }

        if (ruleViolationSummary) {
          const names = Object.keys(ruleViolationSummary);
          cell = sheet.getCell(cur.rowNo, 1);
          setTableHeaderCell(cell);
          if (names.length === 1) {
            cell.value = `Rule violation`;
            sheet.mergeCells(`B${cur.rowNo}:C${cur.rowNo}`);
          } else {
            cell.value = `Rule violations`;
            sheet.mergeCells(`B${cur.rowNo}:C${cur.rowNo + names.length - 1}`);
          }
          names.forEach((name, idx) => {
            cell = sheet.getCell(cur.rowNo, 3);
            cell.value = `*${idx + 1}: ${name}: ${ruleViolationSummary[name]}`;
            cur.rowNo++;
          });
          cur.rowNo++;
        }

        const startIndex = cur.rowNo;

        const { displayRowno } = rdhConfig;

        if (displayRowno) {
          cell = sheet.getCell(cur.rowNo, 1);
          cell.value = "No";
          setTableHeaderCell(cell);
        }

        rdh.keys.forEach((column: RdhKey, idx: number) => {
          let colBasePos = displayRowno ? 2 : 1;
          const cellPhy = sheet.getCell(startIndex, colBasePos + idx);
          cellPhy.value = column.name;
          setTableHeaderCell(cellPhy);

          if (rdhConfig.header.displayComment) {
            const cellLog = sheet.getCell(startIndex + 1, colBasePos + idx);
            cellLog.value = column.comment;
            setTableHeaderCell(cellLog);
          }

          if (rdhConfig.header.displayType) {
            const rowIdx = rdhConfig.header.displayComment ? startIndex + 2 : startIndex + 1;
            const cellType = sheet.getCell(rowIdx, colBasePos + idx);
            cellType.value = EnumValues.getNameFromValue(GeneralColumnType, column.type);
            setTableHeaderCell(cellType);
          }
        });

        cur.rowNo++;
        if (rdhConfig.header.displayComment && rdhConfig.header.displayType) {
          cur.rowNo += 2;
          if (displayRowno) {
            sheet.mergeCells(`A${startIndex}:A${startIndex + 2}`);
          }
        } else if (rdhConfig.header.displayComment || rdhConfig.header.displayType) {
          cur.rowNo++;
          if (displayRowno) {
            sheet.mergeCells(`A${startIndex}:A${startIndex + 1}`);
          }
        }

        rdh.rows
          .filter(
            (row) => !displayOnlyChanged || RowHelper.hasAnyAnnotation(row, ["Add", "Upd", "Del"])
          )
          .forEach((rdhRow, ri) => {
            const inserted = RowHelper.hasAnnotation(rdhRow, "Add");
            let removed = false;
            let updated = false;
            if (!inserted) {
              removed = RowHelper.hasAnnotation(rdhRow, "Del");
            }
            if (!inserted && !removed) {
              updated = RowHelper.hasAnnotation(rdhRow, "Upd");
            }
            const values = rdhRow.values;
            if (displayRowno) {
              const rowNo = ri + 1;
              let cell = sheet.getCell(cur.rowNo, 1);
              cell.value = rowNo;
              if (inserted) {
                fillCell(cell, "Add");
              } else if (removed) {
                fillCell(cell, "Del");
              } else if (updated) {
                fillCell(cell, "Upd");
              }
            }

            rdh.keys.forEach((column: RdhKey, colIdx: number) => {
              let colBasePos = displayRowno ? 2 : 1;
              let annotationMessage: any = undefined;
              let ruleMarker: string | undefined = undefined;
              let resolvedLabel: string | undefined = undefined;
              let format = getCellFormat(column.type);
              const v = values[column.name];
              const cell = sheet.getCell(cur.rowNo, colBasePos + colIdx);

              const isHyperText = column.meta && column.meta.is_hyperlink === true;
              const ruleAnnonations = RowHelper.filterAnnotationByKeyOf<RuleAnnotation>(
                rdhRow,
                column.name,
                "Rul"
              );
              if (ruleAnnonations.length) {
                ruleMarker = toRuleMarker(ruleViolationSummary, ruleAnnonations);
              }

              if (ruleMarker) {
                fillCell(cell, "Rul");
              }
              if (inserted) {
                fillCell(cell, "Add");
              } else if (removed) {
                // const annotation = rdhRow.getFirstAnnotationsOf(column.name, AnnotationType.Del);
                fillCell(cell, "Del");
                // if (annotation) {
                //   annotationMessage = annotation.options?.result;
                // }
              } else if (updated) {
                const annotation = RowHelper.getFirstAnnotationOf<UpdateAnnotation>(
                  rdhRow,
                  column.name,
                  "Upd"
                );
                if (annotation) {
                  fillCell(cell, "Upd");
                  annotationMessage = annotation.values?.otherValue;
                }
              }

              if (rdh.meta.codeItems) {
                resolvedLabel = RowHelper.getFirstAnnotationOf<CodeResolvedAnnotation>(
                  rdhRow,
                  column.name,
                  "Cod"
                )?.values?.label;
              }

              setAnyValueByIndex(cell, v, {
                annotationMessage,
                isHyperText,
                format,
                ruleMarker,
                resolvedLabel,
              });
            });
            cur.rowNo++;
          });

        cur.rowNo += 2;
      }
    });

    // 相手テーブルへのリンク作成
    pairList[0].tableRowNoList.forEach((beforeRowNo, idx) => {
      const afterRowNo = pairList[1].tableRowNoList[idx];
      beforeSheet.getCell(`H${beforeRowNo}`).value = {
        text: "Link to after sheet",
        hyperlink: `#after!A${afterRowNo}`,
      };
    });
    pairList[1].tableRowNoList.forEach((afterRowNo, idx) => {
      const beforeRowNo = pairList[0].tableRowNoList[idx];
      afterSheet.getCell(`H${afterRowNo}`).value = {
        text: "Link to before sheet",
        hyperlink: `#before!A${beforeRowNo}`,
      };
    });

    // Undo Changes
    const undoList = diffList
      .filter((it) => it.undoChangeStatements !== undefined)
      .map((it) => ({
        title: it.title,
        tableName: it.rdh1.meta.tableName,
        undoChangeStatements: it.undoChangeStatements!,
      }));
    if (undoList.length) {
      // create a sheet.
      tocRowNo += 2;
      if (tocSheet) {
        cell = tocSheet.getCell(`C${tocRowNo}`);
        cell.value = "■ Undo changes";
      }
      tocRowNo++;
      const tocRecords = createUndoChangeSheet(workbook, undoList);
      if (tocSheet) {
        tocRowNo += writeTocRecords(tocSheet, tocRecords, tocRowNo);
      }
    }

    // RECORD RULES
    if (options?.rule?.withRecordRule === true) {
      tocRowNo += 2;
      const ruleResultList = list
        .map((it) => getRecordRuleResults(it.rdh2))
        .filter((it) => it !== undefined) as RecordRuleValidationResult[];
      if (ruleResultList.length) {
        if (tocSheet) {
          cell = tocSheet.getCell(`C${tocRowNo}`);
          cell.value = "■ Record Rules";
        }
        tocRowNo++;
        // create a sheet.
        const tocRecords = createRecordRulesSheet(workbook, ruleResultList);
        if (tocSheet) {
          tocRowNo += writeTocRecords(tocSheet, tocRecords, tocRowNo);
        }
      }
    }

    await workbook.xlsx.writeFile(targetExcelPath);
  } catch (e) {
    if (e instanceof Error) {
      errorMessage = e.message;
    } else {
      errorMessage = "Error:" + e;
    }
  }
  return errorMessage;
}

function getCellFormat(type: GeneralColumnType): CellFormat | undefined {
  if (isDateTimeOrDate(type)) {
    return GeneralColumnType.DATE === type ? CellFormat.date : CellFormat.dateTime;
  }
  // if(GeneralColumnType.TIME === type){
  //   return CellFormat.time;
  // }
  return undefined;
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

function createRecordRulesSheet(
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
    sheet.getCell(`A1`).value = { text: "Back to TOC", hyperlink: `#TOC!A1` };
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

function createUndoChangeSheet(
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
    sheet.getCell(`A1`).value = { text: "Back to TOC", hyperlink: `#TOC!A1` };
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

function convertNotNaN(v: number) {
  return isNaN(v) ? "-" : v;
}

function setTableHeaderCell(cell: Excel.Cell) {
  cell.alignment = {
    vertical: "middle",
    horizontal: "center",
  };
  cell.font = { color: { argb: "00ffffff" } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF444444" },
  };
}

function fillCell(cell: Excel.Cell, type: AnnotationType) {
  let fill: Fill | undefined = undefined;
  switch (type) {
    case "Add":
      fill = {
        type: "pattern",
        pattern: "lightGrid",
        fgColor: { argb: "40c3e88d" },
      };
      break;
    case "Upd":
      fill = {
        type: "pattern",
        pattern: "gray125",
        fgColor: { argb: "407053ff" },
      };
      break;
    case "Del":
      fill = {
        type: "pattern",
        pattern: "lightHorizontal",
        fgColor: { argb: "e0ff5370" },
      };
      break;
    case "Rul":
      fill = {
        type: "pattern",
        pattern: "lightTrellis",
        fgColor: { argb: "30e8e853" },
      };
      break;
  }
  if (fill) {
    cell.fill = fill;
  }
}

enum CellFormat {
  // time = 'hh:mm:ss',
  date = "yyyy/mm/dd",
  dateTime = "yyyy/mm/dd hh:mm:ss",
  decimal = "#,##0",
  floatPercent = "0.00%",
}

function setAnyValueByIndex(
  cell: Excel.Cell,
  text: any,
  options?: {
    annotationMessage?: any;
    ruleMarker?: string;
    resolvedLabel?: string;
    isHyperText?: boolean;
    wrap?: boolean;
    horizontal?:
      | "fill"
      | "left"
      | "center"
      | "right"
      | "justify"
      | "centerContinuous"
      | "distributed";
    fontSize?: number;
    format?: CellFormat;
  }
) {
  let cellValue: Excel.CellValue = text;
  if (options) {
    if (options.isHyperText === true) {
      cellValue = {
        text: text,
        hyperlink: text,
      };
      cell.font = { color: { argb: "004e47cc" } };
    }
    if (options.wrap || options.horizontal) {
      cell.alignment = {};
      if (options.wrap) {
        cell.alignment.wrapText = true;
      }
      if (options.horizontal) {
        cell.alignment.horizontal = options.horizontal;
      }
    }
    if (options.fontSize) {
      cell.font = {
        size: options.fontSize,
      };
    }
    let useFormat = !!options.format;
    if (
      options.annotationMessage !== undefined ||
      options.ruleMarker !== undefined ||
      options.resolvedLabel !== undefined
    ) {
      cellValue = {
        richText: [],
      };
      let me = text ?? "";
      let you = options.annotationMessage ?? "";
      let ruleMarker = options.ruleMarker ?? "";
      // 比較対象も横並びにする場合は標準型のまま
      if (options.format) {
        if (options.format === CellFormat.date || options.format === CellFormat.dateTime) {
          me = toDateString(me, options.format);
          if (options.annotationMessage) {
            you = toDateString(you, options.format);
          }
        }
      }
      if (options.ruleMarker) {
        cellValue.richText.push({
          text: `${ruleMarker} `,
          font: {
            color: {
              argb: "33663366",
            },
            size: 8,
          },
        });
      }
      cellValue.richText.push({
        text: me,
      });
      if (options.annotationMessage !== undefined) {
        cellValue.richText.push({
          text: `\n[${you}]`,
          font: {
            color: {
              argb: "66333366",
            },
          },
        });
      }
      if (options.resolvedLabel) {
        cellValue.richText.push({
          text: `\n<${options.resolvedLabel}>`,
          font: {
            color: {
              argb: "33336666",
            },
          },
        });
      }
      useFormat = false;
    }
    if (useFormat && options.format) {
      cell.numFmt = options.format;
      if (options.format === CellFormat.date || options.format === CellFormat.dateTime) {
        cellValue = convertToLocalTimezoneDate(text);
      }
    }
  }
  cell.value = cellValue;
}

function toDateString(target: any, format: CellFormat): string {
  if (target === undefined || target === null || target.length === 0) {
    return "";
  }
  var d = toDate(target)?.toUTCString();
  return dayjs(d)
    .add(dayjs().utcOffset(), "minute")
    .format(format === CellFormat.date ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss");
}

function setAnyValue(
  sheet: Excel.Worksheet,
  c: string,
  text: any,
  options?: {
    isHyperText?: boolean;
    wrap?: boolean;
    horizontal?:
      | "fill"
      | "left"
      | "center"
      | "right"
      | "justify"
      | "centerContinuous"
      | "distributed";
    fontSize?: number;
    format?: CellFormat;
  }
) {
  const cell = sheet.getCell(c);
  setAnyValueByIndex(cell, text, options);
}

function setBorders(sheet: Excel.Worksheet, rs: number, re: number, cs: number, ce: number) {
  for (let c = cs; c <= ce; c++) {
    for (let r = rs; r <= re; r++) {
      sheet.getCell(r, c).border = {
        top: { style: "dashDot", color: { argb: "FF5555FF" } },
        left: { style: "dashDot", color: { argb: "FF5555FF" } },
        bottom: { style: "dashDot", color: { argb: "FF5555FF" } },
        right: { style: "dashDot", color: { argb: "FF5555FF" } },
      };
    }
  }
}

function addImageInSheet(
  workbook: Excel.Workbook,
  sheet: Excel.Worksheet,
  base64: string,
  extension: "jpeg" | "png" | "gif",
  range: { editAs?: string } & Excel.ImageRange
) {
  // add image to workbook by base64
  let imageId = workbook.addImage({
    base64,
    extension,
  });
  // insert an image
  sheet.addImage(imageId, range);
}

function nvl(s: string | undefined, rep: string) {
  if (s === undefined) {
    return rep;
  }
  return s;
}

function toRuleMarker(
  ruleViolationSummary: RdhMeta["ruleViolationSummary"],
  rules: RuleAnnotation[]
): string | undefined {
  if (ruleViolationSummary === undefined) {
    return undefined;
  }
  const marks: number[] = [];
  const names = Object.keys(ruleViolationSummary);
  names.forEach((it, idx) => {
    if (rules.some((rule) => rule.values?.name === it)) {
      marks.push(idx + 1);
    }
  });
  return marks.length > 0 ? `*${marks.join(",")}` : undefined;
}

function writeTocRecords(tocSheet: Excel.Worksheet, tocRecords: TocRecords, rowNo: number): number {
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

  return plusNo;
}

function convertToLocalTimezoneDate(e: Date | undefined | null): Date | undefined | null {
  if (e === null || e === undefined) {
    return e;
  }
  return dayjs(toDate(e.toUTCString())).add(dayjs().utcOffset(), "minute").toDate();
}
