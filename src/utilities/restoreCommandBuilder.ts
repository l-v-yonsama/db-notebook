import { DBRestoreInputParams, RestoreFileCompressionType } from "../shared/DBRestoreParams";

export function buildRestoreCommand(params: DBRestoreInputParams, maskSensitive: boolean): string {
  const { dbType } = params;

  switch (dbType) {
    case "MySQL":
      return buildMysqlRestoreCommand(params, maskSensitive);
    case "Postgres":
      return buildPostgresRestoreCommand(params, maskSensitive);
    case "SQLite":
      return buildSqliteRestoreCommand(params);
    default:
      throw new Error("Unsupported dbType");
  }
}

function buildInputSourceCommand(
  inputFilePath: string,
  fileCompression: RestoreFileCompressionType
): string {
  switch (fileCompression) {
    case "gzip":
      return `gzip -dc "${inputFilePath}"`;
    case "zstd":
      return `zstd -dc "${inputFilePath}"`;
    case "none":
      return `cat "${inputFilePath}"`;
    default:
      throw new Error("Unsupported compression type");
  }
}

function withPreviewComments(command: string, comments: string[], enabled: boolean): string {
  if (!enabled || comments.length === 0) {
    return command;
  }
  return [...comments.map((c) => `# ${c}`), command].join("\n");
}

/* =========================
 * MySQL
 * ========================= */
function buildMysqlRestoreCommand(
  params: DBRestoreInputParams,
  maskSensitive: boolean
): string {
  const {
    dbName,
    userName,
    password,
    host,
    port,
    inputFilePath,
    fileCompression,
    executeRestoreInDockerContainer,
    dockerContainerName,
    advanced,
  } = params;

  const pwd = maskSensitive ? "*****" : password ?? "";

  const mysqlCmd = [
    "mysql",
    advanced.verbose ? "--verbose" : "",
    userName ? `-u ${userName}` : "",
    host ? `-h ${host}` : "",
    port !== undefined ? `-P ${port}` : "",
    dbName,
  ]
    .filter(Boolean)
    .join(" ");

  const localEnv = password ? `MYSQL_PWD=${pwd}` : "";
  const dockerEnv = password ? `-e MYSQL_PWD=${pwd}` : "";

  const inputSource = buildInputSourceCommand(inputFilePath, fileCompression);
  const left = advanced.showProgress ? `${inputSource} | pv` : inputSource;

  const baseCmd = executeRestoreInDockerContainer
    ? pipe(left, [
        `docker exec -i ${dockerEnv} ${dockerContainerName} \\`,
        `  ${mysqlCmd}`,
      ])
    : pipe(left, [[localEnv, mysqlCmd].filter(Boolean).join(" ")]);

  return withPreviewComments(
    baseCmd,
    advanced.showProgress
      ? ["requires pv (Pipe Viewer)", "install: brew install pv"]
      : [],
    maskSensitive
  );
}

/* =========================
 * PostgreSQL
 * ========================= */
function buildPostgresRestoreCommand(
  params: DBRestoreInputParams,
  maskSensitive: boolean
): string {
  const {
    dbName,
    userName,
    password,
    host,
    port,
    inputFilePath,
    fileCompression,
    executeRestoreInDockerContainer,
    dockerContainerName,
    advanced,
  } = params;

  const pwd = maskSensitive ? "*****" : password ?? "";

  const psqlCmd = [
    "psql",
    advanced.verbose ? "--echo-all" : "",
    userName ? `-U ${userName}` : "",
    host ? `-h ${host}` : "",
    port !== undefined ? `-p ${port}` : "",
    `-d ${dbName}`,
  ]
    .filter(Boolean)
    .join(" ");

  const localEnv = password ? `PGPASSWORD=${pwd}` : "";
  const dockerEnv = password ? `-e PGPASSWORD=${pwd}` : "";

  const inputSource = buildInputSourceCommand(inputFilePath, fileCompression);
  const left = advanced.showProgress ? `${inputSource} | pv` : inputSource;

  const baseCmd = executeRestoreInDockerContainer
    ? pipe(left, [
        `docker exec -i ${dockerEnv} ${dockerContainerName} \\`,
        `  ${psqlCmd}`,
      ])
    : pipe(left, [[localEnv, psqlCmd].filter(Boolean).join(" ")]);

  return withPreviewComments(
    baseCmd,
    advanced.showProgress
      ? ["requires pv (Pipe Viewer)", "install: brew install pv"]
      : [],
    maskSensitive
  );
}

/* =========================
 * SQLite
 * ========================= */
/* =========================
 * SQLite
 * ========================= */
function buildSqliteRestoreCommand(params: DBRestoreInputParams): string {
  const {
    dbName,
    inputFilePath,
    fileCompression,
    advanced,
    sqliteOption,
  } = params;

  const lines: string[] = [];

  /* --- 既存DB削除（SQLiteのみ） --- */
  if (sqliteOption?.deleteExistingDb) {
    lines.push(`rm -f "${dbName}"`);
  }

  const inputSource = buildInputSourceCommand(inputFilePath, fileCompression);
  const left = advanced.showProgress ? `${inputSource} | pv` : inputSource;

  lines.push(pipe(left, [`sqlite3 "${dbName}"`]));

  return withPreviewComments(
    joinLines(lines),
    [
      ...(sqliteOption?.deleteExistingDb
        ? ["WARNING: existing SQLite database file will be deleted"]
        : []),
      ...(advanced.showProgress
        ? ["requires pv (Pipe Viewer)", "install: brew install pv"]
        : []),
    ],
    true
  );
}

function joinLines(lines: string[]): string {
  return lines.filter(Boolean).join("\n");
}

function pipe(left: string, rightLines: string[]): string {
  return joinLines([`${left} | \\`, ...rightLines.map((l) => `  ${l}`)]);
}
