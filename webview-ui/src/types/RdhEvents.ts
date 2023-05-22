export type CellFocusParams<T = any> = {
  rowPos: number;
  colPos: number;
  key: string;
  rowValues: T;
  value: any;
};
