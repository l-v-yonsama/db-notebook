import type { DbDynamoTable } from "@l-v-yonsama/multi-platform-database-drivers";

export type DynamoDbIndexKeyRole = {
  indexType: "LSI" | "GSI";
  indexName: string;
  keyType: "PARTITION KEY" | "SORT KEY";
};

export function getDynamoDbIndexKeyRoles(
  table: Pick<DbDynamoTable, "attr">,
  columnName: string
): DynamoDbIndexKeyRole[] {
  const roles: DynamoDbIndexKeyRole[] = [];
  const addRoles = (
    indexType: DynamoDbIndexKeyRole["indexType"],
    indexes: DbDynamoTable["attr"]["lsi"] | DbDynamoTable["attr"]["gsi"]
  ): void => {
    for (const index of indexes) {
      if (!index.IndexName) {
        continue;
      }
      for (const key of index.KeySchema ?? []) {
        if (key.AttributeName === columnName) {
          roles.push({
            indexType,
            indexName: index.IndexName,
            keyType: key.KeyType === "HASH" ? "PARTITION KEY" : "SORT KEY",
          });
        }
      }
    }
  };

  addRoles("LSI", table.attr.lsi);
  addRoles("GSI", table.attr.gsi);
  return roles;
}
