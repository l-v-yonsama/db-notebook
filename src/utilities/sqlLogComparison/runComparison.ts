import { compareSqlExecutions, effectiveSqlEquivalenceOptions, LogParser, LogSqlComparisonResult } from "@l-v-yonsama/multi-platform-database-drivers";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { CancellationToken, FileType, Uri, workspace } from "vscode";
import { createSqlLogComparisonWorkbook } from "../excel/sqlLogComparisonWorkbook";
import { loadComparisonSettings, SqlLogComparisonSettings } from "./configuration";

export class SqlLogComparisonCancelled extends Error {}

type RunSqlLogComparisonBase = {
  beforeFile: Uri;
  afterFile: Uri;
  outputFile: Uri;
  settings: SqlLogComparisonSettings;
  extensionVersion: string;
  token?: CancellationToken;
  report?: (message: string) => void;
};
export type RunSqlLogComparisonParams = RunSqlLogComparisonBase;

function checkCancellation(token?: CancellationToken): void {
  if (token?.isCancellationRequested) {throw new SqlLogComparisonCancelled();}
}

async function readLog(uri: Uri): Promise<string> {
  const stat = await workspace.fs.stat(uri);
  if (!(stat.type & FileType.File)) {throw new Error(`${uri.toString()} is not a file`);}
  return Buffer.from(await workspace.fs.readFile(uri)).toString("utf8");
}

/** Reads exactly two logs, compares extracted SQL and atomically saves a local xlsx. */
export async function runSqlLogComparison(params: RunSqlLogComparisonParams): Promise<LogSqlComparisonResult> {
  const { beforeFile, afterFile, outputFile, settings, token, report } = params;
  if (outputFile.scheme !== "file") {throw new Error("Save the Excel report to a local file");}
  if (beforeFile.toString() === afterFile.toString()) {throw new Error("Select different old and new log files");}
  if ([beforeFile, afterFile].some((uri) => uri.toString() === outputFile.toString() ||
    uri.scheme === "file" && path.resolve(uri.fsPath) === path.resolve(outputFile.fsPath))) {
    throw new Error("The output file must be different from the logs");
  }
  checkCancellation(token);
  report?.("Reading parser configs");
  const loaded = await loadComparisonSettings(settings);
  checkCancellation(token);
  if ([loaded.beforeParser.uri, loaded.afterParser.uri].some((uri) =>
    uri.toString() === outputFile.toString() || uri.scheme === "file" && path.resolve(uri.fsPath) === path.resolve(outputFile.fsPath))) {
    throw new Error("The output file must be different from the log parser configs");
  }
  report?.("Reading old and new logs");
  const beforeText = await readLog(beforeFile);
  checkCancellation(token);
  const afterText = await readLog(afterFile);
  checkCancellation(token);

  report?.("Extracting SQL");
  const before = new LogParser(loaded.beforeParser.config).parse({ logText: beforeText, stage: "sqlExecution", withComparisonInfo: true, language: settings.dialect });
  checkCancellation(token);
  const after = new LogParser(loaded.afterParser.config).parse({ logText: afterText, stage: "sqlExecution", withComparisonInfo: true, language: settings.dialect });
  checkCancellation(token);
  report?.("Comparing SQL");
  const result = compareSqlExecutions({ before, after, options: { dialect: settings.dialect, equivalence: settings.equivalence } });
  checkCancellation(token);

  const temporary = path.join(path.dirname(outputFile.fsPath), `.${path.basename(outputFile.fsPath)}.${randomUUID()}.tmp.xlsx`);
  try {
    report?.("Creating Excel report");
    const driversVersion = require("@l-v-yonsama/multi-platform-database-drivers/package.json").version;
    await createSqlLogComparisonWorkbook({
      result,
      before: { name: path.basename(beforeFile.path), text: beforeText },
      after: { name: path.basename(afterFile.path), text: afterText },
      targetExcelPath: temporary,
      includeEquivalentSql: true,
      effectiveConfig: JSON.stringify({
        settings: {
          dialect: settings.dialect,
          equivalence: effectiveSqlEquivalenceOptions(settings.equivalence),
          beforeParserConfigFile: loaded.beforeParser.uri.toString(),
          afterParserConfigFile: loaded.afterParser.uri.toString(),
        },
        beforeParser: loaded.beforeParser.config,
        afterParser: loaded.afterParser.config,
        extensionVersion: params.extensionVersion,
        driversVersion,
      }),
    });
    checkCancellation(token);
    await fs.rename(temporary, outputFile.fsPath);
    return result;
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {throw error;}
    });
  }
}
