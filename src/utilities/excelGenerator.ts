import * as Excel from "exceljs";
import * as os from "os";
import { EnumValues } from "enum-values";
import {
  AnnotationType,
  CellAnnotation,
  DiffResult,
  GeneralColumnType,
  RdhKey,
  ResultSetData,
  ResultSetDataBuilder,
  RowHelper,
  RuleAnnotation,
  UpdateAnnotation,
  isDateTimeOrDate,
  isDateTimeOrDateOrTime,
  toDate,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Fill } from "exceljs";
import dayjs = require("dayjs");

// const FONT_NAME_Arial ='Arial';
const FONT_NAME_Comic_Sans_MS = "Comic Sans MS";

interface IHyperLink {
  title: string;
  address: string;
}

export type BookCreateOption = {
  files?: any[];
  title?: string;
  subTitle?: string;
  outputWithType?: "none" | "withComment" | "withType" | "both";
  displayOnlyChanged?: boolean;
};

export { columnToLetter, createBookFromList, createBookFromRdh, createBookFromDiffList };

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

function createQueryResultSheet(
  workbook: Excel.Workbook,
  sheetName: string,
  rdh: ResultSetData,
  outputWithType?: BookCreateOption["outputWithType"]
) {
  var sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });

  const colLenMap = new Map<number, number>();

  const cell = sheet.getCell(1, 1);
  cell.value = "No";
  setTableHeaderCell(cell);

  rdh.keys.forEach((column: RdhKey, idx: number) => {
    const cell_phy = sheet.getCell(1, idx + 2);
    cell_phy.value = column.name;
    setTableHeaderCell(cell_phy);
    colLenMap.set(idx, column.name.length);
    if (outputWithType === "both" || outputWithType === "withComment") {
      const cellLog = sheet.getCell(2, idx + 2);
      cellLog.value = column.comment;
      setTableHeaderCell(cellLog);
    }
    if (outputWithType === "both" || outputWithType === "withType") {
      const cellType = sheet.getCell(3, idx + 2);
      cellType.value = EnumValues.getNameFromValue(GeneralColumnType, column.type);
      setTableHeaderCell(cellType);
    }
  });
  let rowIndex = 2;
  if (outputWithType === "both") {
    sheet.mergeCells("A1:A3");
    rowIndex = 4;
  } else if (outputWithType === "withComment" || outputWithType === "withType") {
    sheet.mergeCells("A1:A2");
    rowIndex = 3;
  }

  rdh.rows.forEach((rdhRow, ri: number) => {
    const values = rdhRow.values;
    sheet.getCell(rowIndex, 1).value = ri + 1;
    rdh.keys.forEach((column: RdhKey, colIdx: number) => {
      let ruleMessage: string | undefined = undefined;
      const v = values[column.name];
      const ruleAnnonations = (rdhRow.meta[column.name]?.filter((it) => it.type === "Rul") ??
        []) as RuleAnnotation[];
      let format = getCellFormat(column.type);
      const cell = sheet.getCell(rowIndex, colIdx + 2);
      let isHyperText = column.meta && column.meta.is_hyperlink === true;
      if (ruleAnnonations.length) {
        ruleMessage = ruleAnnonations.map((it) => it.values?.message ?? "").join("\n");
        fillCell(cell, "Rul");
      }
      setAnyValueByIndex(cell, v, { isHyperText, format, ruleMessage });

      const maxLen = colLenMap.get(colIdx)!;
      if (maxLen < (v || "").length) {
        colLenMap.set(colIdx, v.length);
      }
    });
    rowIndex++;
  });
  Array.from(colLenMap.entries()).forEach((entry) => {
    const col = sheet.getColumn(entry[0] + 2);
    col.width = entry[1] > 50 ? 50 : entry[1] + 2;
  });
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

  createQueryResultSheet(workbook, createSheetName(rdh), rdh);

  return new Promise<string>((resolve, reject) => {
    try {
      workbook.xlsx.writeFile(targetExcelPath).then(function () {
        resolve(errorMessage);
      });
    } catch (e: any) {
      reject(e.message);
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

  try {
    // TOC
    let tocSheet = workbook.addWorksheet("TOC", {
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
    // const logo_path = path.join(FileUtil.getStaticDir(), 'images/logo/logo_transparent.png');
    // if (logo_path) {
    //   const logo_base64 = <string>FileUtil.syncReadFile(logo_path, 'base64');
    //   addImageInSheet(workbook, toc_sheet, logo_base64, 'png', {
    //     tl: { col: 0, row: 0 },
    //     br: { col: 5, row: 20 }
    //   });
    // }

    let tocRowIndex = 3;
    let cell = tocSheet.getCell(`C${tocRowIndex}`);
    cell.value = "Table of contents.";
    cell.font = { name: FONT_NAME_Comic_Sans_MS, size: 24 };

    tocRowIndex += 4;
    // FILES PREVIEW
    if (options && options.files && options.files.length > 0) {
      const files = options.files as any[];
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const sheetName = `FILE_${idx}`;
        await createFileSheet(workbook, sheetName, file);
        tocSheet.getCell(`D${tocRowIndex}`).value = {
          text: file.name,
          hyperlink: `#${sheetName}!A1`,
        };
        tocRowIndex += 2;
      }
    }
    // Record rules
    const ruleList = list.filter((it) => ResultSetDataBuilder.from(it).hasAnyAnnotation(["Rul"]));
    if (ruleList.length) {
      await createRecordRulesSheet(workbook, ruleList);
      tocSheet.getCell(`D${tocRowIndex}`).value = {
        text: "Record rules",
        hyperlink: `#RULES!A1`,
      };
      tocRowIndex += 2;
    }
    // RESULTSETS
    const generalList = list.filter(
      (it) => !ResultSetDataBuilder.from(it).hasAnyAnnotation(["Lnt"])
    );
    {
      ["TITLE(TABLE)", "COMMENT", "TYPE", "ROWS"].forEach((key, idx) => {
        let cell = tocSheet.getCell(tocRowIndex, 4 + idx);
        cell.value = key;
        setTableHeaderCell(cell);
      });
    }
    tocRowIndex += 1;
    generalList.forEach((rdh, idx) => {
      const sheetName = createSheetName(rdh, idx + 1);
      tocSheet.getCell(`D${tocRowIndex}`).value = {
        text: sheetName,
        hyperlink: `#${sheetName}!A1`,
      };
      tocSheet.getCell(`E${tocRowIndex}`).value = rdh.meta.comment ?? "";
      tocSheet.getCell(`F${tocRowIndex}`).value = rdh.meta.type ?? "";
      tocSheet.getCell(`G${tocRowIndex}`).value =
        rdh.meta.type === "select" ? rdh.rows.length : "-";
      tocRowIndex += 1;
      // create a sheet.
      createQueryResultSheet(workbook, sheetName, rdh, options?.outputWithType);
    });
  } catch (e) {
    console.error(e);
  }

  return new Promise<string>((resolve, reject) => {
    try {
      workbook.xlsx.writeFile(targetExcelPath).then(function () {
        resolve(errorMessage);
      });
    } catch (e: any) {
      reject(e.message);
    }
  });
}

function createCommonHeader(sheet: Excel.Worksheet) {
  sheet.getCell("A1").value = `Created: ${dayjs().format("YYYY-MM-DD(ddd) HH:mm")}`;
  sheet.getCell("A2").value = `Creator: ${os.userInfo().username}`;
}

async function createBookFromDiffList(
  list: {
    title: string;
    rdh1: ResultSetData;
    rdh2: ResultSetData;
    diffResult: DiffResult;
  }[],
  targetExcelPath: string,
  options?: BookCreateOption
): Promise<string> {
  let errorMessage = "";
  var workbook = new Excel.Workbook();
  const displayOnlyChanged = options?.displayOnlyChanged === true;

  try {
    // TOC
    let tocSheet = workbook.addWorksheet("TOC", {
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
    // const logo_path = path.join(FileUtil.getStaticDir(), 'images/logo/logo_transparent.png');
    // if (logo_path) {
    //   const logo_base64 = <string>FileUtil.syncReadFile(logo_path, 'base64');
    //   addImageInSheet(workbook, toc_sheet, logo_base64, 'png', {
    //     tl: { col: 0, row: 0 },
    //     br: { col: 5, row: 20 }
    //   });
    // }

    let tocRowNo = 3;
    let cell = tocSheet.getCell(`C${tocRowNo}`);
    cell.value = "Table of contents.";
    cell.font = { name: FONT_NAME_Comic_Sans_MS, size: 24 };

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
    tocSheet.getCell("H4").value = "Before time:";
    tocSheet.getCell("H4").alignment = {
      horizontal: "right",
    };
    tocSheet.mergeCells("H4:I4");
    tocSheet.getCell("H5").value = "After  time:";
    tocSheet.getCell("H5").alignment = {
      horizontal: "right",
    };
    tocSheet.mergeCells("H5:I5");
    tocSheet.getCell("J4").value = `${dayjs(beforeDate).format("HH:mm:ss")}`;
    tocSheet.getCell("J5").value = `${dayjs(afterDate).format("HH:mm:ss")}`;

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
      const cell = tocSheet.getCell(tocRowNo, 3 + idx);
      cell.value = title;
      setTableHeaderCell(cell);
    });
    tocSheet.mergeCells(`I${tocRowNo}:J${tocRowNo}`);

    tocRowNo++;
    diffList.forEach((item, idx) => {
      const no = idx + 1;
      const { rdh1, rdh2, title, diffResult } = item;
      pairList[0].rdh = rdh1;
      pairList[1].rdh = rdh2;

      tocSheet.getCell(`C${tocRowNo}`).value = no;
      tocSheet.getCell(`D${tocRowNo}`).value = title;
      tocSheet.getCell(`E${tocRowNo}`).value = rdh1.meta.comment ?? "";
      tocSheet.getCell(`F${tocRowNo}`).value = diffResult.inserted;
      tocSheet.getCell(`G${tocRowNo}`).value = diffResult.deleted;
      tocSheet.getCell(`H${tocRowNo}`).value = diffResult.updated;

      tocSheet.getCell(`I${tocRowNo}`).value = {
        text: "Before" + no,
        hyperlink: `#before!A${pairList[0].rowNo}`,
      };
      tocSheet.getCell(`J${tocRowNo}`).value = {
        text: "After" + no,
        hyperlink: `#after!A${pairList[1].rowNo}`,
      };
      tocRowNo += 1;

      // create a sheet.
      for (const cur of pairList) {
        const { sheet, rdh } = cur;
        if (!rdh) {
          continue;
        }

        cur.tableRowNoList.push(cur.rowNo);
        // table name
        const cellTitle = sheet.getCell(cur.rowNo, 1);
        let titleValue = title;
        if (rdh.meta.comment) {
          titleValue += ` (${rdh.meta.comment})`;
        }
        if (diffResult.message) {
          titleValue += ` [${diffResult.message}]`;
        }
        cellTitle.value = titleValue;
        cur.rowNo++;

        const startIndex = cur.rowNo;
        const cell = sheet.getCell(cur.rowNo, 1);
        cell.value = "No";
        setTableHeaderCell(cell);

        rdh.keys.forEach((column: RdhKey, idx: number) => {
          const cell_phy = sheet.getCell(startIndex, idx + 2);
          cell_phy.value = column.name;
          setTableHeaderCell(cell_phy);

          if (options?.outputWithType === "both" || options?.outputWithType === "withComment") {
            const cellLog = sheet.getCell(startIndex + 1, idx + 2);
            cellLog.value = column.comment;
            setTableHeaderCell(cellLog);
          }

          if (options?.outputWithType === "both" || options?.outputWithType === "withType") {
            const rowIdx = options?.outputWithType === "both" ? startIndex + 2 : startIndex + 1;
            const cellType = sheet.getCell(rowIdx, idx + 2);
            cellType.value = EnumValues.getNameFromValue(GeneralColumnType, column.type);
            setTableHeaderCell(cellType);
          }
        });

        cur.rowNo++;
        if (options?.outputWithType === "both") {
          cur.rowNo += 2;
          sheet.mergeCells(`A${startIndex}:A${startIndex + 2}`);
        } else if (
          options?.outputWithType === "withComment" ||
          options?.outputWithType === "withType"
        ) {
          cur.rowNo++;
          sheet.mergeCells(`A${startIndex}:A${startIndex + 1}`);
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
            const rowNo = ri + 1;
            const values = rdhRow.values;
            let cell = sheet.getCell(cur.rowNo, 1);
            cell.value = rowNo;
            if (inserted) {
              fillCell(cell, "Add");
            } else if (removed) {
              fillCell(cell, "Del");
            } else if (updated) {
              fillCell(cell, "Upd");
            }

            rdh.keys.forEach((column: RdhKey, colIdx: number) => {
              let annotationMessage: any = undefined;
              let format = getCellFormat(column.type);
              const v = values[column.name];
              const cell = sheet.getCell(cur.rowNo, colIdx + 2);
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
              const isHyperText = column.meta && column.meta.is_hyperlink === true;
              setAnyValueByIndex(cell, v, {
                annotationMessage,
                isHyperText,
                format,
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

    await workbook.xlsx.writeFile(targetExcelPath);
  } catch (e: any) {
    errorMessage = e.message;
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

async function createRecordRulesSheet(workbook: Excel.Workbook, list: ResultSetData[]) {
  var sheet = workbook.addWorksheet("RULES", {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  sheet.getCell(`A1`).value = { text: "Back to TOC", hyperlink: `#TOC!A1` };
  sheet.mergeCells("A1:C1");
  sheet.autoFilter = "B3:D3";
  sheet.getColumn("A").width = 2;
  sheet.getColumn("B").width = 15;
  sheet.getColumn("C").width = 18;
  sheet.getColumn("D").width = 32;
  sheet.getColumn("E").width = 70;
  let cell: any;

  const columnMap = new Map<string, string>();
  columnMap.set("B3", "SHEET");
  columnMap.set("C3", "COLUMN");
  columnMap.set("D3", "RULE");
  columnMap.set("E3", "MESSAGE");
  columnMap.forEach((v, k) => {
    // typescript loop [value, key]
    cell = sheet.getCell(k);
    if (cell === null || cell === undefined) {
      console.trace("☆Error cell is null");
    }
    cell.value = v;
    setTableHeaderCell(cell);
  });

  let rowIndex = 4;
  list.forEach((rdh) => {
    rdh.rows
      .filter((it) => RowHelper.hasAnnotation(it, "Rul"))
      .forEach((row) => {
        const ruleAnnonations = RowHelper.filterAnnotationOf<RuleAnnotation>(row, "Rul");
        for (const [k, v] of Object.entries(ruleAnnonations)) {
          v.forEach((annotation) => {
            if (annotation.values) {
              setAnyValue(sheet, `B${rowIndex}`, rdh.meta.tableName ?? "");
              setAnyValue(sheet, `C${rowIndex}`, k);
              setAnyValue(sheet, `D${rowIndex}`, annotation.values.name);
              setAnyValue(sheet, `E${rowIndex}`, annotation.values.message);
              rowIndex++;
            }
          });
        }
      });
  });
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
    fgColor: { argb: "FF4472C4" },
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
        fgColor: { argb: "40ff5370" },
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
    ruleMessage?: string;
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
    font_size?: number;
    format?: CellFormat;
  }
) {
  let cellValue = text;
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
    if (options.font_size) {
      cell.font = {
        size: options.font_size,
      };
    }
    if (options.annotationMessage !== undefined || options.ruleMessage !== undefined) {
      let me = text ?? "";
      let you = options.annotationMessage ?? "";
      let rule = options.ruleMessage ?? "";
      // 比較対象も横並びにする場合は標準型のまま
      if (options.format) {
        if (options.format === CellFormat.date || options.format === CellFormat.dateTime) {
          me = toDateString(me, options.format);
          if (options.annotationMessage) {
            you = toDateString(you, options.format);
          }
        }
      }
      if (options.annotationMessage !== undefined) {
        cellValue = `${me}\n[${you}]`;
      }
      if (options.ruleMessage) {
        cellValue = `${cellValue}\n{${rule}}`;
      }
    } else {
      if (options.format) {
        cell.numFmt = options.format;
        if (options.format === CellFormat.date || options.format === CellFormat.dateTime) {
          cellValue = toDate(text);
        }
      }
    }
  }
  cell.value = cellValue;
}

function toDateString(target: any, format: CellFormat): string {
  if (target === undefined || target === null || target.length === 0) {
    return "";
  }
  return dayjs(target).format(format === CellFormat.date ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss");
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
    font_size?: number;
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
