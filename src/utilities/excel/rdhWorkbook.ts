import { getRecordRuleResults } from "@l-v-yonsama/multi-platform-database-drivers";
import { RecordRuleValidationResult, ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import * as Excel from "exceljs";
import { getOutputConfig, getResultsetConfig } from "../configUtil";
import {
  BookCreateOption,
  createCommonHeader,
  createQueryResultSheet,
  TocRecords,
  writeTocRecords,
} from "./common";
import { createRecordRulesSheet } from "./recordRuleSheet";
import { applyExcelTheme } from "./excelTheme";

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
      const plusRows = createQueryResultSheet(
        workbook,
        sheet,
        rdh,
        baseRowNo,
        getResultsetConfig()
      );
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
      createQueryResultSheet(workbook, sheet, rdh, baseRowNo, getResultsetConfig());
    });
  }

  return tocRecords;
}

function createSheetName(o: ResultSetData | string, no?: number): string {
  const title = typeof o === "string" ? o : (o as ResultSetData).meta?.tableName ?? "";
  if (no !== undefined) {
    return stripSheetName(`${no}_${title}`);
  }
  return stripSheetName(title);
}

export async function createBookFromRdh(rdh: ResultSetData, targetExcelPath: string): Promise<string> {
  let errorMessage = "";
  var workbook = new Excel.Workbook();
  const sheetName = createSheetName("RESULT_SETS");
  var sheet = workbook.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  createQueryResultSheet(workbook, sheet, rdh, 1, getResultsetConfig());
  applyExcelTheme(workbook, getOutputConfig().excel.theme);

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

export async function createBookFromList(
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
      tocSheet.getColumn("E").width = 26;
    }

    let tocRowNo = 4;
    let cell: Excel.Cell;
    if (outputCondig.excel.displayToc) {
      cell = tocSheet!.getCell(`C${tocRowNo}`);
      cell.value = "Table of contents.";
      cell.font = { size: 24 };
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

  applyExcelTheme(workbook, outputCondig.excel.theme);

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
