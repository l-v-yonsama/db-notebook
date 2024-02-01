import type { GeneralColumnType } from "@l-v-yonsama/multi-platform-database-drivers";

export const GeneralColumnTypeConst = {
  BIT: "bit",
  VARBIT: "varbit",
  BOOLEAN: "boolean",
  CHAR: "char",
  VARCHAR: "varchar",
  TINYTEXT: "tinytext",
  MEDIUMTEXT: "mediumtext",
  TEXT: "text",
  LONGTEXT: "longtext",
  CLOB: "clob",
  INET: "inet",
  TINYINT: "tinyint",
  SMALLINT: "smallint",
  MEDIUMINT: "mediumint",
  INTEGER: "integer",
  BIGINT: "bigint",
  DECIMAL: "decimal",
  LONG: "long",
  LONGLONG: "longlong",
  NUMERIC: "numeric",
  FLOAT: "float",
  DOUBLE_PRECISION: "double_precision",
  REAL: "real",
  SERIAL: "serial",
  MONEY: "money",
  JSON: "json",
  JSONB: "jsonb",
  LINE: "line",
  LSEG: "lseg",
  MACADDR: "macaddr",
  PATH: "path",
  PG_LSN: "pg_lsn",
  POINT: "point",
  POLYGON: "polygon",
  GEOMETRY: "geometry",
  TIME: "time",
  TIME_WITH_TIME_ZONE: "time_with_time_zone",
  DATE: "date",
  TIMESTAMP: "timestamp",
  TIMESTAMP_WITH_TIME_ZONE: "timestamp_with_time_zone",
  YEAR: "year",
  ENUM: "enum",
  SET: "set",
  TSQUERY: "tsquery",
  TSVECTOR: "tsvector",
  TXID_SNAPSHOT: "txid_snapshot",
  UUID: "uuid",
  CIDR: "cidr",
  CIRCLE: "circle",
  BOX: "box",
  BYTEA: "bytea",
  BINARY: "binary",
  VARBINARY: "varbinary",
  BLOB: "blob",
  TINYBLOB: "tinyblob",
  MEDIUMBLOB: "mediumblob",
  LONGBLOB: "longblob",
  XML: "xml",
  NAME: "name",
  ARRAY: "array",
  XID: "xid",
  INTERVAL: "interval",
  OID: "oid",
  REGTYPE: "regtype",
  REGPROC: "regproc",
  PG_NODE_TREE: "pg_node_tree",
  PG_NDISTINCT: "pg_ndistinct",
  PG_DEPENDENCIES: "pg_dependencies",
  OBJECT: "object",
  UNKNOWN: "unknown",
} as const;

export function isUUIDType(type: GeneralColumnType): boolean {
  return type === GeneralColumnTypeConst.UUID;
}

export function isNumericLike(type: any): boolean {
  switch (type) {
    // number
    case GeneralColumnTypeConst.TINYINT:
    case GeneralColumnTypeConst.SMALLINT:
    case GeneralColumnTypeConst.MEDIUMINT:
    case GeneralColumnTypeConst.INTEGER:
    case GeneralColumnTypeConst.LONG:
    case GeneralColumnTypeConst.LONGLONG:
    case GeneralColumnTypeConst.BIGINT:
    case GeneralColumnTypeConst.SERIAL:
    case GeneralColumnTypeConst.MONEY:
    case GeneralColumnTypeConst.YEAR:
    case GeneralColumnTypeConst.FLOAT:
    case GeneralColumnTypeConst.DOUBLE_PRECISION:
    case GeneralColumnTypeConst.NUMERIC:
    case GeneralColumnTypeConst.DECIMAL:
      return true;
  }
  return false;
}

export function isTextLike(type: any): boolean {
  switch (type) {
    case GeneralColumnTypeConst.CHAR:
    case GeneralColumnTypeConst.VARCHAR:
    case GeneralColumnTypeConst.TINYTEXT:
    case GeneralColumnTypeConst.MEDIUMTEXT:
    case GeneralColumnTypeConst.TEXT:
    case GeneralColumnTypeConst.LONGTEXT:
      return true;
  }
  return false;
}

/**
 * Tests whether type is BYTEA,BLOB,MEDIUMBLOB,LONGBLOB OR BINARY
 * @param type GeneralColumnType
 * @returns true:BYTEA,BLOB,MEDIUMBLOB,LONGBLOB OR BINARY
 */
export function isBinaryLike(type: any): boolean {
  switch (type) {
    case GeneralColumnTypeConst.BYTEA:
    case GeneralColumnTypeConst.BLOB:
    case GeneralColumnTypeConst.MEDIUMBLOB:
    case GeneralColumnTypeConst.LONGBLOB:
    case GeneralColumnTypeConst.BINARY:
    case GeneralColumnTypeConst.TINYBLOB:
      return true;
  }
  return false;
}

/**
 * Tests whether type is DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 * @param type GeneralColumnType
 * @returns true:DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 */
export function isDateTimeOrDate(type: any): boolean {
  switch (type) {
    case GeneralColumnTypeConst.DATE:
    case GeneralColumnTypeConst.TIMESTAMP:
    case GeneralColumnTypeConst.TIMESTAMP_WITH_TIME_ZONE:
      return true;
  }
  return false;
}

export function isDateTime(type: any): boolean {
  switch (type) {
    case GeneralColumnTypeConst.TIMESTAMP:
    case GeneralColumnTypeConst.TIMESTAMP_WITH_TIME_ZONE:
      return true;
  }
  return false;
}

/**
 * Tests whether type is TIME,TIME_WITH_TIME_ZONE,DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 * @param type GeneralColumnType
 * @returns true:TIME,TIME_WITH_TIME_ZONE,DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 */
export function isDateTimeOrDateOrTime(type: any): boolean {
  switch (type) {
    case GeneralColumnTypeConst.TIME:
    case GeneralColumnTypeConst.TIME_WITH_TIME_ZONE:
    case GeneralColumnTypeConst.DATE:
    case GeneralColumnTypeConst.TIMESTAMP:
    case GeneralColumnTypeConst.TIMESTAMP_WITH_TIME_ZONE:
      return true;
  }
  return false;
}

export function isYear(type: any): boolean {
  return GeneralColumnTypeConst.YEAR === type;
}

export function isDate(type: any): boolean {
  return GeneralColumnTypeConst.DATE === type;
}

/**
 * Tests whether type is JSON or JSONB
 * @param type GeneralColumnType
 * @returns true:JSON or JSONB
 */
export function isJsonLike(type: any): boolean {
  return GeneralColumnTypeConst.JSON === type || GeneralColumnTypeConst.JSONB === type;
}
/**
 * Tests whether type is BOOLEAN or BIT
 * @param type GeneralColumnType
 * @returns true:BOOLEAN or BIT
 */
export function isBooleanLike(type: any): boolean {
  return GeneralColumnTypeConst.BOOLEAN === type || GeneralColumnTypeConst.BIT === type;
}
export function isEnumOrSet(type: any): boolean {
  return GeneralColumnTypeConst.ENUM === type || GeneralColumnTypeConst.SET === type;
}
export function isArray(type: any): boolean {
  return GeneralColumnTypeConst.ARRAY === type;
}
