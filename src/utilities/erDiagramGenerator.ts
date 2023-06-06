import {
  DbColumn,
  DbSchema,
  DbTable,
  displayGeneralColumnType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  ERDiagramParams,
  ERDiagramSettingParams,
  TableColumn,
  TableRelation,
} from "../shared/ERDiagram";

export { createErDiagram, createERDiagramParams, createSimpleERDiagramParams };

function createERDiagramParams(
  allTables: DbTable[],
  params: ERDiagramSettingParams
): ERDiagramParams {
  const tableItems: {
    tableRes: DbTable;
    columnNames: string[];
  }[] = [];
  const relations: TableRelation[] = [];

  params.items.forEach((item) => {
    const tableRes = allTables.find((it) => it.name === item.tableName);
    if (tableRes) {
      tableItems.push({
        tableRes,
        columnNames: item.columnNames,
      });
    }
  });
  params.items.forEach((item) => {
    const tableRes = allTables.find((it) => it.name === item.tableName);
    if (tableRes) {
      if (tableRes.foreignKeys?.referenceTo) {
        for (const [columnName, v] of Object.entries(tableRes.foreignKeys.referenceTo)) {
          if (relations.some((it) => it.name === v.constraintName)) {
            continue;
          }

          if (params.items.some((it) => it.tableName === v.tableName)) {
            let dotted = true;
            if (
              tableRes.getPrimaryColumnNames().length > 1 &&
              tableRes.getPrimaryColumnNames().includes(columnName)
            ) {
              dotted = false;
            }
            const fromColumn = tableRes.getChildByName(columnName);
            if (!fromColumn) {
              continue;
            }
            const toTable = allTables.find((it) => it.name === v.tableName);
            if (!toTable) {
              continue;
            }
            const toColumn = toTable.getChildByName(v.columnName);
            if (!toColumn) {
              continue;
            }
            relations.push({
              name: v.constraintName,
              dotted,
              referencedFrom: {
                tableName: tableRes.name,
                columnName,
                cardinality: makeCardinality(tableRes, fromColumn),
              },
              referenceTo: {
                tableName: v.tableName,
                columnName: v.columnName,
                cardinality: makeCardinality(toTable, toColumn),
              },
            });
          }
        }
      }
      if (tableRes.foreignKeys?.referencedFrom) {
        for (const [columnName, v] of Object.entries(tableRes.foreignKeys.referencedFrom)) {
          if (relations.some((it) => it.name === v.constraintName)) {
            continue;
          }
          const fromColumn = tableRes.getChildByName(v.columnName);
          if (!fromColumn) {
            continue;
          }
          const fromTable = allTables.find((it) => it.name === v.tableName);
          if (!fromTable) {
            continue;
          }
          if (params.items.some((it) => it.tableName === v.tableName)) {
            const toColumn = tableRes.getChildByName(columnName);
            if (!toColumn) {
              continue;
            }
            let dotted = true;
            if (
              fromTable.getPrimaryColumnNames().length > 1 &&
              fromTable.getPrimaryColumnNames().includes(v.columnName)
            ) {
              dotted = false;
            }
            relations.push({
              name: v.constraintName,
              dotted,
              referencedFrom: {
                tableName: fromTable.name,
                columnName: v.columnName,
                cardinality: makeCardinality(fromTable, fromColumn),
              },
              referenceTo: {
                tableName: tableRes.name,
                columnName: columnName,
                cardinality: makeCardinality(tableRes, toColumn),
              },
            });
          }
        }
      }
    }
  });

  return {
    title: params.title,
    tableItems,
    relations,
  };
}

function createSimpleERDiagramParams(
  schema: DbSchema | undefined,
  tableRes: DbTable
): ERDiagramParams {
  let title = tableRes.comment ?? tableRes.name;
  const tableItems: {
    tableRes: DbTable;
    columnNames: string[];
  }[] = [];
  const relations: TableRelation[] = [];

  tableItems.push({ tableRes, columnNames: tableRes.children.map((it) => it.name) });
  if (schema) {
    if (tableRes.foreignKeys?.referenceTo) {
      for (const [columnName, v] of Object.entries(tableRes.foreignKeys.referenceTo)) {
        if (relations.some((it) => it.name === v.constraintName)) {
          continue;
        }
        const fromColumn = tableRes.getChildByName(columnName);
        if (!fromColumn) {
          continue;
        }
        const toTable = schema.getChildByName(v.tableName);
        if (!toTable) {
          continue;
        }
        if (tableItems.every((it) => it.tableRes.name !== toTable.name)) {
          tableItems.push({
            tableRes: toTable,
            columnNames: toTable.children.map((it) => it.name),
          });
        }
        const toColumn = toTable.getChildByName(v.columnName);
        if (!toColumn) {
          continue;
        }
        let dotted = true;
        if (
          tableRes.getPrimaryColumnNames().length > 1 &&
          tableRes.getPrimaryColumnNames().includes(columnName)
        ) {
          dotted = false;
        }
        relations.push({
          name: v.constraintName,
          dotted,
          referencedFrom: {
            tableName: tableRes.name,
            columnName,
            cardinality: makeCardinality(tableRes, fromColumn),
          },
          referenceTo: {
            tableName: v.tableName,
            columnName: v.columnName,
            cardinality: makeCardinality(toTable, toColumn),
          },
        });
      }
    }
    if (tableRes.foreignKeys?.referencedFrom) {
      for (const [columnName, v] of Object.entries(tableRes.foreignKeys.referencedFrom)) {
        if (relations.some((it) => it.name === v.constraintName)) {
          continue;
        }
        const fromColumn = tableRes.getChildByName(v.columnName);
        if (!fromColumn) {
          continue;
        }
        const fromTable = schema.getChildByName(v.tableName);
        if (!fromTable) {
          continue;
        }
        if (tableItems.every((it) => it.tableRes.name !== fromTable.name)) {
          tableItems.push({
            tableRes: fromTable,
            columnNames: fromTable.children.map((it) => it.name),
          });
        }
        const toColumn = tableRes.getChildByName(columnName);
        if (!toColumn) {
          continue;
        }
        let dotted = true;
        if (
          fromTable.getPrimaryColumnNames().length > 1 &&
          fromTable.getPrimaryColumnNames().includes(v.columnName)
        ) {
          dotted = false;
        }
        relations.push({
          name: v.constraintName,
          dotted,
          referencedFrom: {
            tableName: fromTable.name,
            columnName: v.columnName,
            cardinality: makeCardinality(fromTable, fromColumn),
          },
          referenceTo: {
            tableName: tableRes.name,
            columnName: columnName,
            cardinality: makeCardinality(tableRes, toColumn),
          },
        });
      }
    }
  }

  return {
    title,
    tableItems,
    relations,
  };
}

function createErDiagram(params: ERDiagramParams): string {
  const { title, tableItems, relations } = params;
  let text = '```mermaid\n---\ntitle: "' + title + '"\n---\n\nerDiagram\n\n';

  // users ||--o{ articles: ""
  tableItems.forEach((tableItem) => {
    const { tableRes, columnNames } = tableItem;
    text += `${escapeQuot(tableRes.name)} {\n`;
    tableRes.children
      .filter((it) => columnNames.includes(it.name))
      .forEach((columnRes) => {
        let pkOrFk = "";
        if (columnRes.primaryKey) {
          pkOrFk = "PK";
        } else if (tableRes.foreignKeys?.referenceTo?.[columnRes.name]) {
          pkOrFk = "FK";
        }

        if (columnRes.comment) {
          text += `  ${displayGeneralColumnType(columnRes.colType)} ${escapeQuot(
            columnRes.name
          )} ${pkOrFk} "${escapeQuot(columnRes.comment)}"\n`;
        } else {
          text += `  ${displayGeneralColumnType(columnRes.colType)} ${escapeQuot(
            columnRes.name
          )} ${pkOrFk}\n`;
        }
      });
    text += `}\n\n`;
  });

  relations.forEach((relation) => {
    const { name, dotted, referencedFrom, referenceTo } = relation;
    text += `${referencedFrom.tableName} `;
    switch (referencedFrom.cardinality) {
      case "0":
        text += "|o";
        break;
      case "1":
        text += "||";
        break;
      case ">=0":
        text += "}o";
        break;
      case ">=1":
        text += "}|";
        break;
    }
    text += dotted ? ".." : "--";
    switch (referenceTo.cardinality) {
      case "0":
        text += "o|";
        break;
      case "1":
        text += "||";
        break;
      case ">=0":
        text += "o{";
        break;
      case ">=1":
        text += "|{";
        break;
    }
    text += ` ${escapeQuot(referenceTo.tableName)}: "${escapeQuot(name)}"\n`;
  });
  // --	直線
  // ..	破線
  //  ER1 |o--o| ER2: "0 or 1"
  //  ER3 ||--|| ER4: "1"
  //  ER5 }o--o{ ER6: "0以上"
  //  ER7 }|--|{ ER8: "1以上"
  // 受注.顧客番号(FK) }o..|| 顧客.顧客番号(PK)
  // 受注明細.受注番号(PKの一部,FK) }o--|| 受注.受注番号(PK)

  text += "```\n";
  return text;
}

function makeCardinality(table: DbTable, column: DbColumn): TableColumn["cardinality"] {
  if (column.primaryKey) {
    if (table.getPrimaryColumnNames().length > 1) {
      return ">=1";
    }
    return "1"; // Exactly one
  } else if (column.uniqKey) {
    // '0' means 0 or 1
    return column.nullable ? "0" : "1";
  }
  // many
  return column.nullable ? ">=0" : ">=1";
}

function escapeQuot(s: string): string {
  return s.replace(/"/g, "#quot;");
}
