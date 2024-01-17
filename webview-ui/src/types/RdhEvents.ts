import type {
  FileAnnotation,
  GeneralColumnType,
} from "@l-v-yonsama/multi-platform-database-drivers";

export type CellFocusParams<T = any> = {
  rowPos: number;
  colPos: number;
  key: string;
  rowValues: T;
  value: any;
};

export type ShowCellDetailParams = {
  name: string;
  gtype: GeneralColumnType;
  type: string;
  comment: string;
  required?: boolean;
  value: any;
};
