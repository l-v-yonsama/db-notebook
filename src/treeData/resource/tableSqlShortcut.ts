import {
  BaseSQLSupportDriver,
  ConnectionSetting,
  DBDriverResolver,
  DbTable,
  isRDSType,
  toViewDataNormalizedQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";

export type TableSqlShortcut = { qualifiedName: string; selectSql: string };

const quoteIdentifier = (name: string, quote: string): string =>
  `${quote}${name.split(quote).join(quote + quote)}${quote}`;

export const createTableSqlShortcut = (
  setting: ConnectionSetting,
  table: DbTable,
  limit: number
): TableSqlShortcut => {
  if (!isRDSType(setting.dbType)) {
    throw new Error(`${setting.dbType} is not a relational database`);
  }
  const resolver = DBDriverResolver.getInstance();
  const driver = resolver.createSQLSupportDriver<BaseSQLSupportDriver>(setting);
  try {
    const quote = driver.getIdQuoteCharacter() ?? '"';
    const schemaName = driver.isSchemaSpecificationSvailable() ? table.meta?.schemaName : undefined;
    const quotedSchema = schemaName ? quoteIdentifier(schemaName, quote) : undefined;
    const quotedTable = quoteIdentifier(table.name, quote);
    const qualifiedName = quotedSchema ? `${quotedSchema}.${quotedTable}` : quotedTable;
    // The existing SQL generator handles each dialect's LIMIT/TOP/FETCH FIRST.
    // Supplying quoted identifiers also handles reserved words and embedded quotes.
    const { query } = toViewDataNormalizedQuery({
      tableRes: new DbTable(quotedTable, table.tableType),
      schemaName: quotedSchema,
      toPositionedParameter: driver.isPositionedParameterAvailable(),
      toPositionalCharacter: driver.getPositionalCharacter(),
      limitClauseStyle: driver.getLimitClauseStyle(),
      limit,
      sqlLang: driver.getSqlLang(),
      idQuoteCharacter: driver.getIdQuoteCharacter(),
    });
    return { qualifiedName, selectSql: query };
  } finally {
    resolver.removeDriver(driver);
  }
};
