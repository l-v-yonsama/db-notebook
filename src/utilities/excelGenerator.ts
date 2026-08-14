// Public API window for Excel generation. The actual implementation lives under
// ./excel/ split by responsibility:
//   cellStyle.ts        - cell value / border / date / image formatting helpers
//   common.ts            - TOC records, shared header, single-result-set table writer
//   logAnalysisWorkbook.ts - log analysis workbook
//   diffWorkbook.ts      - diff workbook
//   recordRuleSheet.ts   - record rule / undo change sheet generation
//   rdhWorkbook.ts        - normal RDH workbook
// Every symbol below is re-exported so existing `import { ... } from "./excelGenerator"`
// / `"../utilities/excelGenerator"` call sites keep working unchanged.

export type { BookCreateOption } from "./excel/common";
export { columnToLetter } from "./excel/common";
export { createBookFromDiffList } from "./excel/diffWorkbook";
export type { LogAnalysisWorkbookParams } from "./excel/logAnalysisWorkbook";
export { createLogAnalysisWorkbook } from "./excel/logAnalysisWorkbook";
export { createBookFromList, createBookFromRdh } from "./excel/rdhWorkbook";
