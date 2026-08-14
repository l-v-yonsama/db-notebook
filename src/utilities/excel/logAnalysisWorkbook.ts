import { ExtractedSqlResult } from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import * as Excel from "exceljs";
import { getOutputConfig, getResultsetConfig } from "../configUtil";
import { setAnyValueByIndex, setTableHeaderCell } from "./cellStyle";
import { BookCreateOption, createCommonHeader, createQueryResultSheet, FONT_NAME_COMIC_SANS_MS } from "./common";

export type LogAnalysisWorkbookParams = {
  totalLogLines: number;
  linesToParse: number;
  rawLogs: ResultSetData;
  logEvents: ResultSetData;
  sqlEvents?: ResultSetData;
  extractedResult: ExtractedSqlResult;
  targetExcelPath: string;
  options?: BookCreateOption;
};

export async function createLogAnalysisWorkbook(params: LogAnalysisWorkbookParams): Promise<string> {
  const { targetExcelPath, totalLogLines, linesToParse, extractedResult } = params;
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
      tocSheet.getColumn("D").width = 22;
      tocSheet.getColumn("E").width = 26;
    }

    let tocRowNo = 3;
    let cell: Excel.Cell;
    if (outputCondig.excel.displayToc && tocSheet) {
      const curSheet = tocSheet;
      const writeLabelAndValue = (
        tocRowNo: number,
        label: string,
        value: any,
        hyperlink?: string
      ) => {
        let cell: Excel.Cell;
        cell = curSheet.getCell(`D${tocRowNo}`);
        cell.value = label;
        setTableHeaderCell(cell, { horizontal: "left" });
        cell = curSheet.getCell(`E${tocRowNo}`);
        if (hyperlink) {
          setAnyValueByIndex(cell, value, { isHyperText: true, hyperLinkAddr: hyperlink });
        } else {
          cell.value = value;
        }
      };

      // [Title]
      cell = tocSheet.getCell(`C${tocRowNo++}`);
      cell.value = "Log Analysis Report";
      cell.font = { name: FONT_NAME_COMIC_SANS_MS, size: 24 };

      tocRowNo += 2;

      // [Summary]
      const { elapsedTimeMilli, outputSummary } = extractedResult;
      const { totalSqlExecutions, totalEvents, eventTypeCounts, sqlExecutionTypeCounts } =
        outputSummary;
      cell = tocSheet.getCell(`C${tocRowNo++}`);
      cell.value = "[Summary]";
      cell.font = { name: FONT_NAME_COMIC_SANS_MS, size: 18 };
      writeLabelAndValue(tocRowNo++, "Total Log Lines", totalLogLines);
      writeLabelAndValue(tocRowNo++, "Lines to parse", linesToParse < 0 ? "All" : linesToParse);
      writeLabelAndValue(tocRowNo++, "Parsed Events", totalEvents);
      writeLabelAndValue(tocRowNo++, "Extracted SQLs", totalSqlExecutions);
      writeLabelAndValue(tocRowNo++, "Error Rate", extractedResult.errorRate ?? "-");
      writeLabelAndValue(tocRowNo++, "Elapsed Time", ``);
      writeLabelAndValue(tocRowNo++, "  Split Log", `${elapsedTimeMilli.split}ms`);
      if (elapsedTimeMilli.classification !== undefined) {
        writeLabelAndValue(tocRowNo++, "  Classify", `${elapsedTimeMilli.classification}ms`);
      }
      if (elapsedTimeMilli.sqlExecutions !== undefined) {
        writeLabelAndValue(tocRowNo++, "  Extract SQL", `${elapsedTimeMilli.sqlExecutions}ms`);
      }
      writeLabelAndValue(tocRowNo++, "  Total", `${elapsedTimeMilli.total}ms`);

      tocRowNo++;

      if (totalEvents && extractedResult.stage !== "split") {
        // [Classified Log Events]
        cell = tocSheet.getCell(`C${tocRowNo++}`);
        cell.value = "[Classified Log Events]";
        cell.font = { name: FONT_NAME_COMIC_SANS_MS, size: 18 };
        for (const [key, value] of Object.entries(eventTypeCounts)) {
          writeLabelAndValue(tocRowNo++, key, value ?? 0);
        }
        tocRowNo++;
      }

      if (totalSqlExecutions) {
        // [Extracted SQL Summary]
        cell = tocSheet.getCell(`C${tocRowNo++}`);
        cell.value = "[Extracted SQL Summary]";
        cell.font = { name: FONT_NAME_COMIC_SANS_MS, size: 18 };
        for (const [key, value] of Object.entries(sqlExecutionTypeCounts)) {
          writeLabelAndValue(tocRowNo++, key, value ?? 0);
        }
        tocRowNo++;
      }

      tocRowNo += 4;

      // [Navigation]
      cell = tocSheet.getCell(`C${tocRowNo++}`);
      cell.value = "[Navigation]";
      cell.font = { name: FONT_NAME_COMIC_SANS_MS, size: 18 };
      writeLabelAndValue(tocRowNo++, "Raw Logs", "Link to Raw Logs", "#RawLogs!A1");
      if (elapsedTimeMilli.classification !== undefined) {
        writeLabelAndValue(
          tocRowNo++,
          "Parsed Events",
          "Link to Parsed Events",
          "#ParsedEvents!A1"
        );
      }
      if (elapsedTimeMilli.sqlExecutions !== undefined && params.sqlEvents) {
        writeLabelAndValue(
          tocRowNo++,
          "Extracted SQLs",
          "Link to Extracted SQLs",
          "#ExtractedSQLs!A1"
        );
      }
    }

    createLogAnalysisWorksheets(workbook, params);
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

function createLogAnalysisWorksheets(
  workbook: Excel.Workbook,
  params: LogAnalysisWorkbookParams
): void {
  const { totalLogLines, linesToParse, rawLogs, logEvents, sqlEvents } = params;
  const outputCondig = getOutputConfig();
  const rdhConfig = getResultsetConfig();
  rdhConfig.header.displayComment = false;
  rdhConfig.header.displayType = false;

  const rawLogsSheet = workbook.addWorksheet("RawLogs", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  if (outputCondig.excel.displayToc) {
    const cell = rawLogsSheet.getCell(`A1`);
    setAnyValueByIndex(cell, "Back to TOC", { isHyperText: true, hyperLinkAddr: "#TOC!A1" });
  }
  rawLogsSheet.mergeCells("A1:C1");
  rawLogsSheet.getColumn("A").width = 2;
  rawLogsSheet.getColumn("B").width = 8;
  rawLogsSheet.getColumn("C").width = 214;

  rawLogsSheet.getCell(`B2`).value = `  ( Total log lines: ${totalLogLines} / Lines to parse: ${
    linesToParse < 0 ? "All" : linesToParse
  } )`;
  createQueryResultSheet(workbook, rawLogsSheet, rawLogs, 3, rdhConfig, {
    sqlStatementLabel: "Path",
  });

  // ParsedEvents
  const parsedEventsSheet = workbook.addWorksheet("ParsedEvents", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });
  if (outputCondig.excel.displayToc) {
    const cell = parsedEventsSheet.getCell(`A1`);
    setAnyValueByIndex(cell, "Back to TOC", { isHyperText: true, hyperLinkAddr: "#TOC!A1" });
  }
  parsedEventsSheet.mergeCells("A1:C1");
  parsedEventsSheet.getColumn("A").width = 2;

  logEvents.keys.forEach((key, idx) => {
    // 1=>A, 2=>B
    const colNumber = idx + 2;
    switch (key.name) {
      case "lineNo":
        parsedEventsSheet.getColumn(colNumber).width = 8;
        break;
      case "timestamp":
        parsedEventsSheet.getColumn(colNumber).width = 30;
        break;
      case "eventType":
        parsedEventsSheet.getColumn(colNumber).width = 20;
        break;
      case "thread":
        parsedEventsSheet.getColumn(colNumber).width = 24;
        break;
      case "logger":
        parsedEventsSheet.getColumn(colNumber).width = 32;
        break;
      case "message":
        parsedEventsSheet.getColumn(colNumber).width = 160;
        break;
      case "transformed":
        parsedEventsSheet.getColumn(colNumber).width = 40;
        break;
    }
  });
  createQueryResultSheet(workbook, parsedEventsSheet, logEvents, 3, rdhConfig, {
    sqlStatementLabel: "Summary",
  });

  // ExtractedSQLs
  if (sqlEvents) {
    const extractedSQLsSheet = workbook.addWorksheet("ExtractedSQLs", {
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: { paperSize: 9, orientation: "portrait" },
    });
    if (outputCondig.excel.displayToc) {
      const cell = extractedSQLsSheet.getCell(`A1`);
      setAnyValueByIndex(cell, "Back to TOC", { isHyperText: true, hyperLinkAddr: "#TOC!A1" });
    }
    extractedSQLsSheet.mergeCells("A1:C1");
    extractedSQLsSheet.getColumn("A").width = 2;

    sqlEvents.keys.forEach((key, idx) => {
      // 1=>A, 2=>B
      const colNumber = idx + 2;
      switch (key.name) {
        case "startLine":
        case "endLine":
          extractedSQLsSheet.getColumn(colNumber).width = 8;
          break;
        case "timestamp":
          extractedSQLsSheet.getColumn(colNumber).width = 29;
          break;
        case "thread":
          extractedSQLsSheet.getColumn(colNumber).width = 18;
          break;
        case "daoClass":
        case "daoMethod":
          extractedSQLsSheet.getColumn(colNumber).width = 28;
          break;
        case "table":
        case "params":
        case "result":
          extractedSQLsSheet.getColumn(colNumber).width = 22;
          break;
        case "type":
          extractedSQLsSheet.getColumn(colNumber).width = 13;
          break;
        case "content":
        case "detail":
          extractedSQLsSheet.getColumn(colNumber).width = 100;
          break;
        case "framework":
          extractedSQLsSheet.getColumn(colNumber).width = 10;
          break;
      }
    });
    createQueryResultSheet(workbook, extractedSQLsSheet, sqlEvents, 3, rdhConfig, {
      sqlStatementLabel: "Summary",
      adjustRow: {
        maxRowCount: 20,
        calcKeys: ["content", "detail"],
      },
    });
  }
}

