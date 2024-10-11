import type { GeneralColumnType } from "@l-v-yonsama/rdh";

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

export type ShowRecordParams = {
  value: any;
};
