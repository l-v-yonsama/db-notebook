import { workspace } from "vscode";
import { NodeConfigType, SQLFormatterConfigType } from "../types/Config";

export const getFormatterConfig = (): SQLFormatterConfigType => {
  const settings = workspace.getConfiguration("sql-formatter", null);

  return {
    uppercase: settings.get("uppercase", false),
    linesBetweenQueries: settings.get("linesBetweenQueries", 2),
    indent: " ".repeat(settings.get("tabWidth", 2)),
  };
};

export const getNodeConfig = (): NodeConfigType => {
  const settings = workspace.getConfiguration("node", null);

  return {
    commandPath: settings.get("Node path", ""),
    dataEncoding: settings.get("encoding", ""),
  };
};
