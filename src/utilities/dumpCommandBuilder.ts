import { DBDumpInputParams } from "../shared/DBDumpParams";

/**
 * Build DB Dump command
 */
export function buildDumpCommand(
  params: DBDumpInputParams,
  maskSensitive: boolean
): string {
  switch (params.dbType) {
    case "MySQL":
      return buildMySqlDumpCommand(params, maskSensitive);
    case "Postgres":
      return buildPostgresDumpCommand(params, maskSensitive);
    case "SQLite":
      return buildSqliteDumpCommand(params);
    default:
      return "";
  }
}

/* =========================
 * MySQL
 * ========================= */
function buildMySqlDumpCommand(
  params: DBDumpInputParams,
  maskSensitive: boolean
): string {
  const {
    dbName,
    userName,
    password,
    selectedTables,
    targetScope,
    options,
    executeDumpInDockerContainer,
    dockerContainerName,
    outputTarget,
    outputFilePrefix,
    outputCompression = "none",
  } = params;

  const args: string[] = ["mysqldump"];
  const dockerEnvArgs: string[] = [];

  if (userName) args.push(`-u ${quote(userName)}`);

  if (password) {
    const value = maskSensitive ? "****" : password;
    if (executeDumpInDockerContainer) {
      dockerEnvArgs.push(`-e MYSQL_PWD=${quote(value)}`);
    } else {
      args.push(`-p${quote(value)}`);
    }
  }

  args.push(quote(dbName));

  if (targetScope === "tables" && selectedTables.length) {
    selectedTables.forEach((t) => args.push(quote(t)));
  }

  appendDumpOptions(args, options);

  return buildFinalDumpCommand({
    baseArgs: args,
    dockerEnvArgs,
    executeDumpInDockerContainer,
    dockerContainerName,
    outputTarget,
    outputFilePrefix,
    outputCompression,
    dbType: "MySQL",
  });
}

/* =========================
 * PostgreSQL
 * ========================= */
function buildPostgresDumpCommand(
  params: DBDumpInputParams,
  maskSensitive: boolean
): string {
  const {
    dbName,
    userName,
    password,
    targetScope,
    selectedSchemas,
    selectedTables,
    options,
    executeDumpInDockerContainer,
    dockerContainerName,
    outputTarget,
    outputFilePrefix,
    outputCompression = "none",
  } = params;

  const args: string[] = ["pg_dump"];
  const dockerEnvArgs: string[] = [];

  if (userName) args.push(`-U ${quote(userName)}`);

  if (password) {
    const value = maskSensitive ? "****" : password;
    if (executeDumpInDockerContainer) {
      dockerEnvArgs.push(`-e PGPASSWORD=${quote(value)}`);
    } else {
      dockerEnvArgs.push(`PGPASSWORD=${quote(value)}`);
    }
  }

  args.push(quote(dbName));

  if (targetScope === "schemas" && selectedSchemas.length) {
    selectedSchemas.forEach((s) => {
      args.push(`--schema=${quote(s)}`);
    });
  }

  if (targetScope === "tables" && selectedTables.length) {
    // 完全修飾名前提（schema.table）
    selectedTables.forEach((t) => {
      args.push(`--table=${quote(t)}`);
    });
  }

  appendDumpOptions(args, options);

  return buildFinalDumpCommand({
    baseArgs: args,
    dockerEnvArgs,
    executeDumpInDockerContainer,
    dockerContainerName,
    outputTarget,
    outputFilePrefix,
    outputCompression,
    dbType: "Postgres",
  });
}

/* =========================
 * SQLite
 * ========================= */
function buildSqliteDumpCommand(params: DBDumpInputParams): string {
  const {
    dbName,
    selectedTables,
    targetScope,
    outputTarget,
    outputFilePrefix,
    outputCompression = "none",
  } = params;

  const args: string[] = ["sqlite3", quote(dbName)];

  if (targetScope === "tables" && selectedTables.length) {
    args.push(quote(`.dump ${selectedTables.join(" ")}`));
  } else {
    args.push(quote(".dump"));
  }

  return buildFinalDumpCommand({
    baseArgs: args,
    dockerEnvArgs: [],
    executeDumpInDockerContainer: false,
    dockerContainerName: "",
    outputTarget,
    outputFilePrefix,
    outputCompression,
    dbType: "SQLite",
  });
}

/* ===============================
 * 共通ユーティリティ
 * =============================== */

function appendDumpOptions(
  args: string[],
  options: DBDumpInputParams["options"]
) {
  for (const opt of options) {
    if (!opt.enabled) continue;

    if (!opt.argType) {
      args.push(opt.option);
      continue;
    }

    const value = opt.param ?? opt.defaultValue;
    if (value !== undefined) {
      args.push(`${opt.option}=${quote(String(value))}`);
    }
  }
}

function buildFinalDumpCommand({
  baseArgs,
  dockerEnvArgs,
  executeDumpInDockerContainer,
  dockerContainerName,
  outputTarget,
  outputFilePrefix,
  outputCompression,
  dbType,
}: {
  baseArgs: string[];
  dockerEnvArgs: string[];
  executeDumpInDockerContainer: boolean;
  dockerContainerName: string;
  outputTarget: DBDumpInputParams["outputTarget"];
  outputFilePrefix: string;
  outputCompression: DBDumpInputParams["outputCompression"];
  dbType: DBDumpInputParams["dbType"];
}): string {
  const parts: string[] = [
    ...(executeDumpInDockerContainer && dockerContainerName
      ? ["docker exec", ...dockerEnvArgs, quote(dockerContainerName)]
      : dockerEnvArgs),
    ...baseArgs,
  ];

  if (outputTarget === "file") {
    if (!outputFilePrefix) {
      throw new Error("outputFilePrefix is required when outputTarget === 'file'");
    }

    let outputPath = `${outputFilePrefix}.sql`;

    if (outputCompression === "gzip") {
      parts.push("|", "gzip");
      outputPath += ".gz";
    } else if (outputCompression === "zstd") {
      parts.push("|", "zstd");
      outputPath += ".zst";
    }

    parts.push(">", quote(outputPath));
  }

  return joinCommandLines(parts);
}

function quote(value: string): string {
  if (/[\s"'\\]/.test(value)) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  return value;
}

function joinCommandLines(parts: string[], indent = "  "): string {
  return parts.map((p, i) => (i === 0 ? p : `${indent}${p}`)).join(" \\\n");
}