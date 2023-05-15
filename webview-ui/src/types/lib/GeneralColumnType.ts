import { EnumValues } from "enum-values";

export enum GeneralColumnType {
  BIT,
  VARBIT,
  BOOLEAN,
  CHAR,
  VARCHAR,
  TINYTEXT,
  MEDIUMTEXT,
  TEXT,
  LONGTEXT,
  CLOB,
  INET,
  TINYINT,
  SMALLINT,
  MEDIUMINT,
  INTEGER,
  BIGINT,
  DECIMAL,
  LONG,
  LONGLONG,
  NUMERIC,
  FLOAT,
  DOUBLE_PRECISION,
  REAL,
  SERIAL,
  MONEY,
  JSON,
  JSONB,
  LINE,
  LSEG,
  MACADDR,
  PATH,
  PG_LSN,
  POINT,
  POLYGON,
  TIME,
  TIME_WITH_TIME_ZONE,
  DATE,
  TIMESTAMP,
  TIMESTAMP_WITH_TIME_ZONE,
  YEAR,
  ENUM,
  SET,
  TSQUERY,
  TSVECTOR,
  TXID_SNAPSHOT,
  UUID,
  CIDR,
  CIRCLE,
  BOX,
  BYTEA,
  BINARY,
  BLOB,
  MEDIUMBLOB,
  LONGBLOB,
  XML,
  NAME,
  ARRAY,
  XID,
  INTERVAL,
  OID,
  REGTYPE,
  REGPROC,
  PG_NODE_TREE,
  PG_NDISTINCT,
  PG_DEPENDENCIES,
  OBJECT,
  UNKNOWN = -1,
}
// export namespace GeneralColumnType {
//   export function parse(s: string | null | undefined): GeneralColumnType {
//     if (s === undefined || s === null) {
//       return GeneralColumnType.UNKNOWN;
//     }
//     s = s.toUpperCase();
//     if ("VAR_STRING" === s) {
//       return GeneralColumnType.VARCHAR;
//     } else if ("TINY" === s) {
//       return GeneralColumnType.TINYINT;
//     } else if ("DATETIME" === s || "TIMESTAMP(6)" === s) {
//       return GeneralColumnType.TIMESTAMP;
//     } else if ("VARCHAR2" === s) {
//       return GeneralColumnType.VARCHAR;
//     } else if ("NUMBER" === s) {
//       return GeneralColumnType.NUMERIC;
//     }
//     const list = EnumValues.getNamesAndValues(GeneralColumnType);
//     const m = list.find((a) => a.name === s);
//     if (m) {
//       return <number>m.value;
//     }
//     return GeneralColumnType.UNKNOWN;
//   }
//   export function isNumericLike(type: GeneralColumnType): boolean {
//     switch (type) {
//       // number
//       case GeneralColumnType.TINYINT:
//       case GeneralColumnType.SMALLINT:
//       case GeneralColumnType.MEDIUMINT:
//       case GeneralColumnType.INTEGER:
//       case GeneralColumnType.LONG:
//       case GeneralColumnType.LONGLONG:
//       case GeneralColumnType.BIGINT:
//       case GeneralColumnType.SERIAL:
//       case GeneralColumnType.MONEY:
//       case GeneralColumnType.YEAR:
//       case GeneralColumnType.FLOAT:
//       case GeneralColumnType.DOUBLE_PRECISION:
//       case GeneralColumnType.NUMERIC:
//       case GeneralColumnType.DECIMAL:
//         return true;
//     }
//     return false;
//   }

//   export function isTextLike(type: GeneralColumnType): boolean {
//     switch (type) {
//       case GeneralColumnType.CHAR:
//       case GeneralColumnType.VARCHAR:
//       case GeneralColumnType.TINYTEXT:
//       case GeneralColumnType.MEDIUMTEXT:
//       case GeneralColumnType.TEXT:
//       case GeneralColumnType.LONGTEXT:
//         return true;
//     }
//     return false;
//   }

//   /**
//    * Tests whether type is BYTEA,BLOB,MEDIUMBLOB,LONGBLOB OR BINARY
//    * @param type GeneralColumnType
//    * @returns true:BYTEA,BLOB,MEDIUMBLOB,LONGBLOB OR BINARY
//    */
//   export function isBinaryLike(type: GeneralColumnType): boolean {
//     switch (type) {
//       case GeneralColumnType.BYTEA:
//       case GeneralColumnType.BLOB:
//       case GeneralColumnType.MEDIUMBLOB:
//       case GeneralColumnType.LONGBLOB:
//       case GeneralColumnType.BINARY:
//         return true;
//     }
//     return false;
//   }
//   /**
//    * Tests whether type is TIME,TIME_WITH_TIME_ZONE,DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
//    * @param type GeneralColumnType
//    * @returns true:TIME,TIME_WITH_TIME_ZONE,DATE,TIMESTAMP OR TIMESTAMP_WITH_TIME_ZONE
//    */
//   export function isDateOrTimeLike(type: GeneralColumnType): boolean {
//     switch (type) {
//       case GeneralColumnType.TIME:
//       case GeneralColumnType.TIME_WITH_TIME_ZONE:
//       case GeneralColumnType.DATE:
//       case GeneralColumnType.TIMESTAMP:
//       case GeneralColumnType.TIMESTAMP_WITH_TIME_ZONE:
//         return true;
//     }
//     return false;
//   }
//   /**
//    * Tests whether type is JSON or JSONB
//    * @param type GeneralColumnType
//    * @returns true:JSON or JSONB
//    */
//   export function isJsonLike(type: GeneralColumnType): boolean {
//     return GeneralColumnType.JSON === type || GeneralColumnType.JSONB === type;
//   }
//   /**
//    * Tests whether type is BOOLEAN or BIT
//    * @param type GeneralColumnType
//    * @returns true:BOOLEAN or BIT
//    */
//   export function isBooleanLike(type: GeneralColumnType): boolean {
//     return GeneralColumnType.BOOLEAN === type || GeneralColumnType.BIT === type;
//   }
//   export function isEnumOrSet(type: GeneralColumnType): boolean {
//     return GeneralColumnType.ENUM === type || GeneralColumnType.SET === type;
//   }
//   export function isArray(type: GeneralColumnType): boolean {
//     return GeneralColumnType.ARRAY === type;
//   }

//   export function parseHandsonType(type: GeneralColumnType): string {
//     switch (type) {
//       // number
//       case GeneralColumnType.TINYINT:
//       case GeneralColumnType.SMALLINT:
//       case GeneralColumnType.MEDIUMINT:
//       case GeneralColumnType.INTEGER:
//       case GeneralColumnType.LONG:
//       case GeneralColumnType.LONGLONG:
//       case GeneralColumnType.BIGINT:
//       case GeneralColumnType.SERIAL:
//       case GeneralColumnType.MONEY:
//       case GeneralColumnType.YEAR:
//         return "numeric_integers";
//       case GeneralColumnType.FLOAT:
//       case GeneralColumnType.DOUBLE_PRECISION:
//       case GeneralColumnType.NUMERIC:
//       case GeneralColumnType.DECIMAL:
//         return "numeric_decimals";
//       case GeneralColumnType.DATE:
//         return "date";
//       case GeneralColumnType.TIMESTAMP:
//       case GeneralColumnType.TIMESTAMP_WITH_TIME_ZONE:
//         return "timestamp";
//       case GeneralColumnType.BIT:
//         return "text";
//       case GeneralColumnType.VARBIT:
//         return "text";
//       case GeneralColumnType.BOOLEAN:
//         return "checkbox";
//       case GeneralColumnType.BOX:
//         return "text";
//       // blob
//       case GeneralColumnType.BYTEA:
//       case GeneralColumnType.BLOB:
//       case GeneralColumnType.MEDIUMBLOB:
//       case GeneralColumnType.LONGBLOB:
//       case GeneralColumnType.BINARY:
//         return "text";
//       case GeneralColumnType.INET:
//         return "text";
//       case GeneralColumnType.CHAR:
//         return "text";
//       case GeneralColumnType.VARCHAR:
//         return "text";
//       case GeneralColumnType.CIDR:
//         return "text";
//       case GeneralColumnType.CIRCLE:
//         return "text";
//       case GeneralColumnType.JSON:
//         return "text";
//       case GeneralColumnType.JSONB:
//         return "text";
//       case GeneralColumnType.LINE:
//         return "text";
//       case GeneralColumnType.LSEG:
//         return "text";
//       case GeneralColumnType.MACADDR:
//         return "text";
//       case GeneralColumnType.PATH:
//         return "text";
//       case GeneralColumnType.PG_LSN:
//         return "text";
//       case GeneralColumnType.POINT:
//         return "text";
//       case GeneralColumnType.POLYGON:
//         return "text";
//       case GeneralColumnType.REAL:
//         return "text";
//       case GeneralColumnType.TINYTEXT:
//       case GeneralColumnType.MEDIUMTEXT:
//       case GeneralColumnType.TEXT:
//       case GeneralColumnType.LONGTEXT:
//       case GeneralColumnType.CLOB:
//         return "text";
//       case GeneralColumnType.TIME:
//         return "text";
//       case GeneralColumnType.TIME_WITH_TIME_ZONE:
//         return "text";
//       case GeneralColumnType.TSQUERY:
//         return "text";
//       case GeneralColumnType.TSVECTOR:
//         return "text";
//       case GeneralColumnType.TXID_SNAPSHOT:
//         return "text";
//       case GeneralColumnType.UUID:
//         return "text";
//       case GeneralColumnType.XML:
//         return "text";
//       // enum, set
//       case GeneralColumnType.ENUM:
//       case GeneralColumnType.SET:
//         return "text";
//       case GeneralColumnType.UNKNOWN:
//         return "text";
//       default:
//         return "text";
//     }
//   }

//   export function parseFaIconType(type: GeneralColumnType): string {
//     switch (type) {
//       // string
//       case GeneralColumnType.CHAR:
//       case GeneralColumnType.VARCHAR:
//       case GeneralColumnType.TINYTEXT:
//       case GeneralColumnType.MEDIUMTEXT:
//       case GeneralColumnType.TEXT:
//       case GeneralColumnType.LONGTEXT:
//       case GeneralColumnType.CLOB:
//         return "fa-font";
//       // time
//       case GeneralColumnType.TIME:
//       case GeneralColumnType.TIME_WITH_TIME_ZONE:
//         return "fa-clock";
//       // date
//       case GeneralColumnType.DATE:
//         return "fa-calendar";
//       // datetime
//       case GeneralColumnType.TIMESTAMP:
//       case GeneralColumnType.TIMESTAMP_WITH_TIME_ZONE:
//         return "fa-calendar-times";
//       // int, long
//       case GeneralColumnType.TINYINT:
//       case GeneralColumnType.SMALLINT:
//       case GeneralColumnType.INTEGER:
//       case GeneralColumnType.BIGINT:
//       case GeneralColumnType.LONG:
//       case GeneralColumnType.LONGLONG:
//       case GeneralColumnType.SERIAL:
//         return "fa-sort-numeric-down";
//       // float, double, real
//       case GeneralColumnType.DECIMAL:
//       case GeneralColumnType.FLOAT:
//       case GeneralColumnType.DOUBLE_PRECISION:
//       case GeneralColumnType.REAL:
//         return "fa-sort-numeric-down";
//       // number
//       case GeneralColumnType.NUMERIC:
//         return "fa-sort-numeric-down";
//       // money
//       case GeneralColumnType.MONEY:
//         return "fa-money-bill-alt";
//       // bit
//       case GeneralColumnType.BIT:
//       case GeneralColumnType.VARBIT:
//         return "fa-chess-board";
//       // boolean
//       case GeneralColumnType.BOOLEAN:
//         return "fa-chess-board";
//       // json
//       case GeneralColumnType.JSON:
//       case GeneralColumnType.JSONB:
//         return "fa-code";
//       // binary or blob
//       case GeneralColumnType.BINARY:
//       case GeneralColumnType.BYTEA:
//       case GeneralColumnType.BLOB:
//       case GeneralColumnType.MEDIUMBLOB:
//       case GeneralColumnType.LONGBLOB:
//         return "fa-chess-board";
//       // array
//       case GeneralColumnType.ARRAY:
//         return "fa-list";
//       // object
//       case GeneralColumnType.OBJECT:
//         return "fa-folder";
//       // etc
//       case GeneralColumnType.BOX:
//       case GeneralColumnType.CIDR:
//       case GeneralColumnType.CIRCLE:
//       case GeneralColumnType.INET:
//       case GeneralColumnType.LINE:
//       case GeneralColumnType.LSEG:
//       case GeneralColumnType.MACADDR:
//       case GeneralColumnType.PATH:
//       case GeneralColumnType.PG_LSN:
//       case GeneralColumnType.POINT:
//       case GeneralColumnType.POLYGON:
//       case GeneralColumnType.TSQUERY:
//       case GeneralColumnType.TSVECTOR:
//       case GeneralColumnType.TXID_SNAPSHOT:
//       case GeneralColumnType.UUID:
//       case GeneralColumnType.XML:
//       case GeneralColumnType.NAME:
//       case GeneralColumnType.XID:
//       case GeneralColumnType.INTERVAL:
//       case GeneralColumnType.OID:
//       case GeneralColumnType.REGTYPE:
//       case GeneralColumnType.REGPROC:
//       case GeneralColumnType.PG_NODE_TREE:
//       case GeneralColumnType.PG_NDISTINCT:
//       case GeneralColumnType.PG_DEPENDENCIES:
//       case GeneralColumnType.UNKNOWN:
//         return "fa-question-circle";
//       // enum, set
//       case GeneralColumnType.ENUM:
//         return "fa-list";
//       case GeneralColumnType.SET:
//         return "fa-list-ol";
//       default:
//         return "fa-question-circle";
//     }
//   }
// }
