import type { DbTable, DBType } from "@l-v-yonsama/multi-platform-database-drivers";

export type DumpDBType = "mysql" | "postgresql" | "sqlite";
export type DumpOptionGroup =
  | "content" //（内容）スキーマ？データ？
  | "filter" // （条件指定）一部だけ欲しい
  | "performance" // （性能・負荷）速く／軽く／止めない
  | "compat" // （互換性・移行）他環境に持っていく
  | "advanced"; // （上級者向け）触ると壊れうるやつ
export type RiskLevelType = "safe" | "caution" | "danger";

export type DBDumpOptionParams = {
  /** 内部識別子（Vueのkey・状態管理用） */
  id: string;

  group: DumpOptionGroup;

  riskLevel: RiskLevelType;

  /** 指定有無 */
  enabled: boolean;

  /** 実際のコマンドオプション */
  option: string;

  /** 短い説明（UI表示用） */
  description: string;

  /** 詳細説明（tooltip / help用） */
  descriptionDetail?: string;

  /** パラメータ種別 */
  argType?: "string" | "number" | "boolean" | "enum";

  /** 入力パラメータ */
  param?: string | number | boolean;

  /** 初期値 */
  defaultValue?: string | number | boolean;

  /** enumの場合 */
  enumValues?: string[];

  /** 依存オプション */
  requires?: string[];

  /** 排他オプション */
  conflictsWith?: string[];
};

export type DumpOutputTarget =
  | "stdout" // 標準出力
  | "file"; // ファイル出力

export type DumpOutputFormat =
  | "sql" // プレーンSQL
  | "csv" // CSV
  | "binary" // pg_dump custom など
  | "directory"; // pg_dump directory

export type OutputCompressionType = "none" | "gzip" | "zstd";

export type DBExportSettingsInputParams = {
  dbName: string;
  dbType: DBType;
  schemaName: string;
  userName: string;
  password: string;
  targetScope: "database" | "tables";
  selectedTables: string[];

  /** 出力先 */
  outputTarget: DumpOutputTarget;

  /** ファイル名の接頭辞（outputTarget === "file" の時のみ使用） */
  outputFilePrefix: string;

  /** 出力形式（拡張子・後処理に影響） */
  outputFormat?: DumpOutputFormat;

  outputCompression?: OutputCompressionType;

  options: DBDumpOptionParams[];
  executeDumpInDockerContainer: boolean;
  dockerContainerName: string;
};

export type DBExportSettingsUIParams = {
  tables: DbTable[];
  dockerContainerItems: { label: string; value: string }[];
  previewCommand: string;
  scrollPos: number;
};
