// Public API entry point for Excel generation. The implementation files live
// alongside this file and are split by responsibility:
//   cellStyle.ts        - cell value / border / date / image formatting helpers
//   common.ts            - TOC records, shared header, single-result-set table writer
//   logAnalysisWorkbook.ts - log analysis workbook
//   diffWorkbook.ts      - diff workbook
//   recordRuleSheet.ts   - record rule / undo change sheet generation
//   rdhWorkbook.ts        - normal RDH workbook
// Consumers import this directory instead of depending on an individual
// workbook implementation.

export type { BookCreateOption } from "./common";
export { columnToLetter } from "./common";
export { createBookFromDiffList } from "./diffWorkbook";
export type { LogAnalysisWorkbookParams } from "./logAnalysisWorkbook";
export { createLogAnalysisWorkbook } from "./logAnalysisWorkbook";
export { createBookFromList, createBookFromRdh } from "./rdhWorkbook";
