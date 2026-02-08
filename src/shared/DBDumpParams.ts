import type { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import type { LabelValueItem } from "./LabelValueItem";

/* =========================
 * Dump option definitions
 * ========================= */

export type DumpOptionGroup =
  | "content"      // スキーマ / データ
  | "filter"       // テーブル・条件指定
  | "performance"  // 負荷・速度
  | "compat"       // 移行互換性
  | "advanced";    // 危険度高

export type RiskLevelType = "safe" | "caution" | "danger";

export type DBDumpOptionParams = {
  /** 内部識別子（Vue key / 状態管理用） */
  id: string;

  group: DumpOptionGroup;
  riskLevel: RiskLevelType;

  /** 有効・無効 */
  enabled: boolean;

  /** 実際のコマンドオプション */
  option: string;

  /** UI 表示用の短い説明 */
  description: string;

  /** tooltip / help 用の詳細説明 */
  descriptionDetail?: string;

  /** 引数タイプ */
  argType?: "string" | "number" | "boolean" | "enum";

  /** 入力値 */
  param?: string | number | boolean;

  /** 初期値 */
  defaultValue?: string | number | boolean;

  /** enum 候補 */
  enumValues?: string[];

  /** 依存関係 */
  requires?: string[];

  /** 排他関係 */
  conflictsWith?: string[];
};

/* =========================
 * Output
 * ========================= */

export type DumpOutputTarget =
  | "stdout"   // 標準出力
  | "file";    // ファイル出力

export type OutputCompressionType = "none" | "gzip" | "zstd";

/* =========================
 * Dump input params
 * ========================= */

export type DBDumpInputParams = {
  /** DB 基本情報 */
  dbName: string;
  dbType: DBType;

  /** 認証 */
  userName: string;
  password: string;
  port?: number;
  host?: string;

  /** 対象範囲 */
  targetScope: "database" | "schemas" | "tables";

  /** Postgres のみ */
  selectedSchemas: string[];

  /**
   * 完全修飾テーブル名
   * MySQL / SQLite: ["emp", "dept"]
   * Postgres: ["public.emp", "test2.dept"]
   */
  selectedTables: string[];

  /** 出力先 */
  outputTarget: DumpOutputTarget;

  /** ファイル出力時の接頭辞（必須） */
  outputFilePrefix: string;

  /** 圧縮形式 */
  outputCompression?: OutputCompressionType;

  /** dump オプション */
  options: DBDumpOptionParams[];

  /** Docker */
  executeDumpInDockerContainer: boolean;
  dockerContainerName: string;
};

/* =========================
 * UI params
 * ========================= */

export type DBDumpSettingsUIParams = {
  schemas: LabelValueItem[];
  tables: LabelValueItem[];
  dockerContainerItems: LabelValueItem[];
  previewCommand: string;
  scrollPos: number;
};