import * as GC from "@/types/lib/GeneralColumnType";

export function isNumericLike(type: GC.GeneralColumnType): boolean {
  switch (type) {
    // number
    case GC.GeneralColumnType.TINYINT:
    case GC.GeneralColumnType.SMALLINT:
    case GC.GeneralColumnType.MEDIUMINT:
    case GC.GeneralColumnType.INTEGER:
    case GC.GeneralColumnType.LONG:
    case GC.GeneralColumnType.LONGLONG:
    case GC.GeneralColumnType.BIGINT:
    case GC.GeneralColumnType.SERIAL:
    case GC.GeneralColumnType.MONEY:
    case GC.GeneralColumnType.YEAR:
    case GC.GeneralColumnType.FLOAT:
    case GC.GeneralColumnType.DOUBLE_PRECISION:
    case GC.GeneralColumnType.NUMERIC:
    case GC.GeneralColumnType.DECIMAL:
      return true;
  }
  return false;
}

export function isTextLike(type: GC.GeneralColumnType): boolean {
  switch (type) {
    case GC.GeneralColumnType.CHAR:
    case GC.GeneralColumnType.VARCHAR:
    case GC.GeneralColumnType.TINYTEXT:
    case GC.GeneralColumnType.MEDIUMTEXT:
    case GC.GeneralColumnType.TEXT:
    case GC.GeneralColumnType.LONGTEXT:
      return true;
  }
  return false;
}

/**
 * Tests whether type is BYTEA,BLOB,MEDIUMBLOB,LONGBLOB OR BINARY
 * @param type GC.GeneralColumnType
 * @returns true:BYTEA,BLOB,MEDIUMBLOB,LONGBLOB OR BINARY
 */
export function isBinaryLike(type: GC.GeneralColumnType): boolean {
  switch (type) {
    case GC.GeneralColumnType.BYTEA:
    case GC.GeneralColumnType.BLOB:
    case GC.GeneralColumnType.MEDIUMBLOB:
    case GC.GeneralColumnType.LONGBLOB:
    case GC.GeneralColumnType.BINARY:
    case GC.GeneralColumnType.TINYBLOB:
      return true;
  }
  return false;
}

/**
 * Tests whether type is DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 * @param type GC.GeneralColumnType
 * @returns true:DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 */
export function isDateTimeOrDate(type: GC.GeneralColumnType): boolean {
  switch (type) {
    case GC.GeneralColumnType.DATE:
    case GC.GeneralColumnType.TIMESTAMP:
    case GC.GeneralColumnType.TIMESTAMP_WITH_TIME_ZONE:
      return true;
  }
  return false;
}

/**
 * Tests whether type is TIME,TIME_WITH_TIME_ZONE,DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 * @param type GC.GeneralColumnType
 * @returns true:TIME,TIME_WITH_TIME_ZONE,DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
 */
export function isDateTimeOrDateOrTime(type: GC.GeneralColumnType): boolean {
  switch (type) {
    case GC.GeneralColumnType.TIME:
    case GC.GeneralColumnType.TIME_WITH_TIME_ZONE:
    case GC.GeneralColumnType.DATE:
    case GC.GeneralColumnType.TIMESTAMP:
    case GC.GeneralColumnType.TIMESTAMP_WITH_TIME_ZONE:
      return true;
  }
  return false;
}

/**
 * Tests whether type is JSON or JSONB
 * @param type GC.GeneralColumnType
 * @returns true:JSON or JSONB
 */
export function isJsonLike(type: GC.GeneralColumnType): boolean {
  return GC.GeneralColumnType.JSON === type || GC.GeneralColumnType.JSONB === type;
}
/**
 * Tests whether type is BOOLEAN or BIT
 * @param type GC.GeneralColumnType
 * @returns true:BOOLEAN or BIT
 */
export function isBooleanLike(type: GC.GeneralColumnType): boolean {
  return GC.GeneralColumnType.BOOLEAN === type || GC.GeneralColumnType.BIT === type;
}
export function isEnumOrSet(type: GC.GeneralColumnType): boolean {
  return GC.GeneralColumnType.ENUM === type || GC.GeneralColumnType.SET === type;
}
export function isArray(type: GC.GeneralColumnType): boolean {
  return GC.GeneralColumnType.ARRAY === type;
}
