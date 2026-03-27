/* =========================================================
 * SQL Formatter
 * Corresponds to: sql-formatter.*
 * ========================================================= */
export type SQLFormatterConfigType = {
  /** Keyword case */
  keywordCase?: 'upper' | 'lower' | 'preserve';

  /** Indentation width (spaces) */
  tabWidth?: number;

  /** Use tabs instead of spaces */
  useTabs?: boolean;

  /** Max line width before wrapping */
  expressionWidth?: number;

  /** Blank lines between queries */
  linesBetweenQueries?: number;
};

/* =========================================================
 * Node.js Execution
 * Corresponds to: node.*
 * ========================================================= */
export type NodeConfigType = {
  /** Path to a custom Node.js executable */
  commandPath?: string;

  /** STDOUT / STDERR encoding of the Node.js process */
  dataEncoding: NodeProcessDataEncodingType;

  /** Directory used for temporary files during execution */
  tmpDirPath?: string;
};

export type NodeProcessDataEncodingType =
  | ""
  | "UTF8"
  | "Shift_JIS"
  | "Windows-31j"
  | "Windows932"
  | "EUC-JP"
  | "GB2312"
  | "GBK"
  | "GB18030"
  | "Windows936"
  | "EUC-CN"
  | "KS_C_5601"
  | "Windows949"
  | "EUC-KR";

/* =========================================================
 * ResultSet
 * - Preview  : VS Code Notebook / Webview table
 * - Format   : Value representation (shared by preview/output)
 * Corresponds to: resultset.*
 * ========================================================= */
export type ResultsetConfigType = {
  /* -------------------------
   * ResultSet Preview (VS Code UI)
   * ------------------------- */
  header: {
    /** Show column comments in the ResultSet preview header */
    displayComment: boolean;

    /** Show column data types in the ResultSet preview header */
    displayType: boolean;
  };

  /** Display row numbers in the ResultSet preview */
  displayRowno: boolean;

  /** Maximum number of characters shown per cell in preview */
  maxCharactersInCell: number;

  /** Maximum number of rows shown in preview */
  maxRowsInPreview: number;

  /* -------------------------
   * ResultSet Data Formatting
   * (applies to preview and output)
   * ------------------------- */
  /** Date format applied to DATE values */
  dateFormat: "YYYY-MM-DD" | "YYYY-MM-DD HH:mm:ss";

  /** Timestamp format applied to TIMESTAMP values */
  timestampFormat:
    | "YYYY-MM-DD"
    | "YYYY-MM-DD HH:mm:ss"
    | "YYYY-MM-DD HH:mm:ss.SSS"
    | "YYYY-MM-DDTHH:mm:ss.SSSZ";

  /** End-of-line character used in generated output */
  eol: "\n" | "\r" | "\r\n";

  /** Convert binary values to hexadecimal representation */
  binaryToHex: boolean;
};

/* =========================================================
 * Database Execution
 * Corresponds to: database.*
 * ========================================================= */
export type DatabaseConfigType = {
  /** Default LIMIT applied to SQL queries */
  limitRows: number;
};

/* =========================================================
 * Output (HTML / Excel)
 * Corresponds to: output.*
 * These settings DO NOT affect the VS Code preview.
 * ========================================================= */
export type OutputConfigType = {
  /** Maximum number of rows written to output files */
  maxRows: number;

  /** Maximum number of characters written per cell in output files */
  maxCharactersInCell: number;

  excel: {
    /** Create a table of contents sheet in Excel output */
    displayToc: boolean;

    /** Show executed SQL and table info before each ResultSet */
    displayTableNameAndStatement: boolean;

    /** Enable links between paired ResultSets (before / after) */
    enableCrossPairLinks: boolean;
  };

  html: {
    /** Create a table of contents section in HTML output */
    displayToc: boolean;

    /** Display charts and graphs in HTML output */
    displayGraphs: boolean;
  };
};
