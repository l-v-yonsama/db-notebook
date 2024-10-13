import { ToStringParam } from "@l-v-yonsama/rdh";
import { workspace } from "vscode";
import {
  DatabaseConfigType,
  NodeConfigType,
  OutputConfigType,
  ResultsetConfigType,
  SQLFormatterConfigType,
  SQLSeparatorConfigType,
} from "../types/Config";

export const getFormatterConfig = (): SQLFormatterConfigType => {
  const settings = workspace.getConfiguration("sql-formatter", null);

  return {
    uppercase: settings.get("uppercase", false),
    linesBetweenQueries: settings.get("linesBetweenQueries", 2),
    indent: " ".repeat(settings.get("tabWidth", 2)),
  };
};

export const getSQLSeparatorConfig = (): SQLSeparatorConfigType => {
  const settings = workspace.getConfiguration("sql-separator", null);

  return {
    keepSemicoron: settings.get("keepSemicoron", false),
  };
};

export const getNodeConfig = (): NodeConfigType => {
  const settings = workspace.getConfiguration("node", null);

  return {
    commandPath: settings.get("Node path", ""),
    dataEncoding: settings.get("encoding", ""),
    tmpDirPath: settings.get("Tmp dir path", ""),
  };
};

export const getResultsetConfig = (): ResultsetConfigType => {
  const settings = workspace.getConfiguration("resultset", null);

  return {
    header: {
      displayComment: settings.get("Header display comment", true),
      displayType: settings.get("Header display type", false),
    },
    displayRowno: settings.get("Display rowno", false),
    maxCharactersInCell: settings.get("Max characters in cell", 100),
    maxRowsInPreview: settings.get("Max rows in preview", 10),
    dateFormat: settings.get("Date format", "YYYY-MM-DD"),
    eol: settings.get("End of Line", "\n"),
    binaryToHex: settings.get("Binary to Hex", false),
  };
};

export const getDatabaseConfig = (): DatabaseConfigType => {
  const settings = workspace.getConfiguration("database", null);

  return {
    limitRows: settings.get("Default limit rows", 100),
  };
};

export const getOutputConfig = (): OutputConfigType => {
  const settings = workspace.getConfiguration("output", null);

  return {
    maxRows: settings.get("Max rows in output file", 10000),
    maxCharactersInCell: settings.get("Max characters in cell in output file", 10000),
    html: {
      displayToc: settings.get("Html: display TOC", true),
      displayGraphs: settings.get("Html: display graphs", true),
    },
  };
};

export const getToStringParamByConfig = (options?: Partial<ToStringParam>): ToStringParam => {
  const output = getOutputConfig();
  const rdh = getResultsetConfig();
  const config: ToStringParam = {
    maxPrintLines: output.maxRows,
    maxCellValueLength: output.maxCharactersInCell,
    withType: rdh.header.displayType,
    withComment: rdh.header.displayComment,
    withRowNo: rdh.displayRowno,
    withCodeLabel: true,
    withRuleViolation: true,
    dateFormat: rdh.dateFormat,
    eol: rdh.eol,
    binaryToHex: rdh.binaryToHex,
  };

  if (options) {
    return {
      ...config,
      ...options,
    };
  }
  return config;
};
