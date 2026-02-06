import { DBExportSettingsInputParams } from "../shared/DBDumpParams";


export function buildDumpCommand(
  params: DBExportSettingsInputParams,
  maskSensitive: boolean
): string {
  const {
    dbType,
    dbName,
    userName,
    password,
    targetScope,
    selectedTables,
    options,
    executeDumpInDockerContainer,
    dockerContainerName,
    outputTarget,
    outputFilePrefix,
    outputFormat,
    outputCompression = "none",
  } = params;

  let baseCommand = "";
  const args: string[] = [];
  const dockerEnvArgs: string[] = [];

  /* ===============================
   * DB ごとのベースコマンド
   * =============================== */
  switch (dbType) {
    case "MySQL":
      baseCommand = "mysqldump";
      if (userName) args.push(`-u ${quote(userName)}`);
      break;

    case "Postgres":
      baseCommand = "pg_dump";
      if (userName) args.push(`-U ${quote(userName)}`);
      break;

    case "SQLite":
      baseCommand = "sqlite3";
      break;

    default:
      return "";
  }

  /* ===============================
   * パスワード
   * =============================== */
  if (password) {
    const value = maskSensitive ? "****" : password;
    if (executeDumpInDockerContainer) {
      if (dbType === "MySQL") dockerEnvArgs.push(`-e MYSQL_PWD=${quote(value)}`);
      if (dbType === "Postgres") dockerEnvArgs.push(`-e PGPASSWORD=${quote(value)}`);
    } else {
      if (dbType === "MySQL") args.push(`-p${quote(value)}`);
      if (dbType === "Postgres") dockerEnvArgs.push(`PGPASSWORD=${quote(value)}`);
    }
  }

  /* ===============================
   * 対象スコープ
   * =============================== */
  if (targetScope === "database") {
    if (dbType === "SQLite") {
      args.push(quote(dbName), quote(".dump"));
    } else {
      args.push(quote(dbName));
    }
  } else if (selectedTables?.length) {
    switch (dbType) {
      case "MySQL":
        args.push(quote(dbName));
        selectedTables.forEach((t) => args.push(quote(t)));
        break;
      case "Postgres":
        args.push(quote(dbName));
        selectedTables.forEach((t) => args.push(`--table=${quote(t)}`));
        break;
      case "SQLite":
        args.push(quote(dbName), quote(`.dump ${selectedTables.join(" ")}`));
        break;
    }
  }

  /* ===============================
   * dump オプション
   * =============================== */
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

  /* ===============================
   * コマンド本体
   * =============================== */
  const parts: string[] = [
    ...(executeDumpInDockerContainer && dockerContainerName
      ? ["docker exec", ...dockerEnvArgs, quote(dockerContainerName)]
      : dockerEnvArgs),
    baseCommand,
    ...args,
  ];

  /* ===============================
   * 出力 + 圧縮制御
   * =============================== */
  if (outputTarget === "file") {
    if (!outputFilePrefix) {
      throw new Error("outputFilePrefix is required when outputTarget === 'file'");
    }

    const baseSuffix = resolveOutputSuffix(dbType, outputFormat) ?? "";
    let outputPath = `${outputFilePrefix}${baseSuffix}`;

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

/* ===============================
 * 共通ユーティリティ
 * =============================== */
function resolveOutputSuffix(
  dbType: DBExportSettingsInputParams["dbType"],
  format?: DBExportSettingsInputParams["outputFormat"]
): string | undefined {
  switch (dbType) {
    case "Postgres":
      switch (format) {
        case "binary":
          return ".dump";
        case "directory":
          return ""; // ディレクトリ
        case "sql":
        default:
          return ".sql";
      }

    case "MySQL":
    case "SQLite":
      return ".sql";

    default:
      return undefined;
  }
}
function quote(value: string): string {
  if (/[\s"'\\]/.test(value)) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  return value;
}

function joinCommandLines(parts: string[], indent = "  "): string {
  return parts.map((p, i) => (i === 0 ? p : `${indent}${p}`)).join(` \\\n`);
}
