import {
  LogParseConfig,
  LogSqlComparisonOptions,
  validateLogSqlComparisonOptions,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, workspace } from "vscode";
import { readLogParseConfiguration } from "../logParseConfiguration";

export type SqlLogComparisonSettings = {
  beforeParserConfigFile: Uri;
  afterParserConfigFile: Uri;
  dialect: LogSqlComparisonOptions["dialect"];
  equivalence?: LogSqlComparisonOptions["equivalence"];
};

type ConfigSource = { uri: Uri; config: LogParseConfig };

async function loadParserConfig(uri: Uri): Promise<ConfigSource> {
  const source = Buffer.from(await workspace.fs.readFile(uri)).toString("utf8");
  const parsed = readLogParseConfiguration(source);
  if (!parsed.config || !parsed.configuration.canParse) {
    throw new Error(`${uri.toString()}: ${parsed.configuration.parseError || "SQL extraction is not configured"}`);
  }
  return { uri, config: parsed.config };
}

export async function loadComparisonSettings(settings: SqlLogComparisonSettings): Promise<{
  beforeParser: ConfigSource;
  afterParser: ConfigSource;
}> {
  validateLogSqlComparisonOptions({ dialect: settings.dialect, equivalence: settings.equivalence });
  return {
    beforeParser: await loadParserConfig(settings.beforeParserConfigFile),
    afterParser: await loadParserConfig(settings.afterParserConfigFile),
  };
}
