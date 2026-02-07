import type { DBType } from "@l-v-yonsama/multi-platform-database-drivers";

/* =========================
 * Restore options
 * ========================= */

export type RestoreFileCompressionType = "none" | "gzip" | "zstd";

export type RestoreAdvancedOption = {
  showProgress: boolean; // pv 使用
  verbose: boolean;      // mysql --verbose / psql --echo-all
};

/** SQLite 専用オプション */
export type SQLiteRestoreOption = {
  /** 既存 DB ファイルを削除してから復元 */
  deleteExistingDb: boolean;
};

/* =========================
 * Restore input params
 * ========================= */

export type DBRestoreInputParams = {
  /** DB 基本情報 */
  dbType: DBType;
  dbName: string;

  /** 認証（SQLite では未使用） */
  userName?: string;
  password?: string;

  /** dump ファイル */
  inputFilePath: string;
  fileCompression: RestoreFileCompressionType;

  /** Docker */
  executeRestoreInDockerContainer: boolean;
  dockerContainerName?: string;

  /** 共通オプション */
  advanced: RestoreAdvancedOption;

  /** SQLite 専用 */
  sqliteOption?: SQLiteRestoreOption;
};

/* =========================
 * UI params
 * ========================= */

export type DBRestoreSettingsUIParams = {
  dockerContainerItems: { label: string; value: string }[];
  previewCommand: string;
  scrollPos: number;
};