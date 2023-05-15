export type CellFocusParams<T = any> = {
  rowPos: number;
  colPos: number;
  cell: string;
  colKey: string;
  rowValues: T;
  value: any;
};
