import type { DbTable } from "@l-v-yonsama/multi-platform-database-drivers";

export type TableColumn = {
  tableName: string;
  columnName: string;
  cardinality: "0" | "1" | ">=0" | ">=1";
};

export type TableRelation = {
  name: string;
  dotted: boolean;
  referencedFrom: TableColumn;
  referenceTo: TableColumn;
};

export type ERDiagramParams = {
  title: string;
  tableItems: {
    tableRes: DbTable;
    columnNames: string[];
  }[];
  relations: TableRelation[];
};

export type ERDiagramSettingItem = {
  tableName: string;
  columnNames: string[];
};

export type ERDiagramSettingParams = {
  title: string;
  items: ERDiagramSettingItem[];
};
