import type { GeneralColumnType } from "./GeneralColumnType";
import type { RdhMeta } from "./ResultSetHelperMetadata";
export declare class SampleClassPair {
  clazz_value: any;
  sample_values: any[];
}
export declare class SampleGroupByClass {
  pairs: SampleClassPair[];
  clazz_key: string;
  sample_keys: string[];
  is_shuffled: boolean;
  constructor(clazz_key: string, sample_keys: string[]);
}
export declare class RdhKey {
  name: string;
  comment: string;
  type: GeneralColumnType;
  width?: number;
  meta?: {
    is_image?: boolean;
    is_hyperlink?: boolean;
  };
  constructor(name: string, type?: GeneralColumnType, comment?: string);
  toString(): string;
}
export enum AnnotationType {
  Del = 0,
  Upd = 1,
  Add = 2,
  Err = 3,
  Lnt = 4,
  Stl = 5,
}
export interface AnnotationOptions {
  message?: string;
  result?: any;
  style?: AnnotationStyleOptions;
}
export interface AnnotationStyleOptions {
  f?: {
    s: number;
    n: string;
  };
  a?: {
    h?: string;
    v?: string;
  };
  b?: string;
  fmt?: string;
}
export declare class CellAnnotation {
  type: AnnotationType;
  options?: AnnotationOptions;
  styles?: AnnotationStyleOptions;
  constructor(type: AnnotationType, options?: AnnotationOptions);
}
export interface MergedCell {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}
export declare class RdhRow {
  meta: {
    [key: string]: CellAnnotation[];
  };
  values: any;
  constructor(meta: any, values: any);
  pushAnnotation(key: string, type: AnnotationType, options?: AnnotationOptions): void;
  clearAllAnnotations(): void;
  clearAnnotations(type: AnnotationType): void;
  getAnnotations(type: AnnotationType): CellAnnotation[];
  getFirstAnnotationsOf(key: string, type: AnnotationType): CellAnnotation | undefined;
  getAnnotationsOf(key: string, type: AnnotationType): CellAnnotation[];
  hasAnnotation(type: AnnotationType): boolean;
}
export type ToStringParam = {
  maxPrintLines?: number;
  withType?: boolean;
  withComment?: boolean;
};
export declare class ResultSetDataHolder {
  keys: RdhKey[];
  rows: Array<RdhRow>;
  readonly meta: RdhMeta;
  sqlStatement: string | undefined;
  shuffledIndexes?: number[];
  shuffledNextCounter?: number;
  mergeCells?: MergedCell[];
  constructor(keys: Array<string | RdhKey>);
  static createEmpty(): ResultSetDataHolder;
  static from(list: any, i_titles?: string | string[]): ResultSetDataHolder;
  sampleCorrelation(key_x: string, key_y: string): number;
  describe(): ResultSetDataHolder;
  splitRows(
    test_percentage: number,
    with_shuffle?: boolean
  ): [ResultSetDataHolder, ResultSetDataHolder];
  sampleXKeysGroupByClass(
    numExamplesPerClass: number,
    xKeys: string[],
    clazz: string,
    shuffle?: boolean
  ): SampleGroupByClass;
  nextXYBatch(batch_size: number, xKeys: string[], yKey: string): [any[][], any[]];
  hasKey(key: string): boolean;
  drop(key: string): void;
  assign(key: string, list: any): void;
  assignFromDictionary(new_key: string, existing_key: string, dictionary: string[]): void;
  toVector(key_name: string, is_only_number?: boolean): Array<any>;
  toMatrixArray(key_names?: string[]): Array<Array<any>>;
  toCsv(config?: { key_names?: string[] }): string;
  addRow(recordData: any, default_meta?: any): void;
  clearRows(): void;
  copyFrom(that: ResultSetDataHolder): void;
  setSqlStatement(sqlStatement: string): void;
  hasAnnotation(type: AnnotationType): boolean;
  fillnull(how: "mean" | "median"): void;
  resetKeyTypeByRows(): void;
  setKeys(keys: Array<string | RdhKey>): void;
  keynames(is_only_numeric_like?: boolean): string[];
  addKey(k: string | RdhKey): void;
  private toShortString;
  toString(params?: ToStringParam): string;
}
