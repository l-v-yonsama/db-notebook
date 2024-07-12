export type SQLFormatterConfigType = {
  indent?: string;
  uppercase?: boolean;
  linesBetweenQueries?: number;
};
export type NodeConfigType = {
  commandPath?: string;
  dataEncoding: NodeProcessDataEncodingType;
  tmpDirPath?: string;
};
export type NodeProcessDataEncodingType =
  | ""
  | "UTF8"
  | "Shift_JIS"
  | "Windows-31j"
  | "Windows932"
  | "EUC-JP"
  | "GB2312"
  | "GBK"
  | "GB18030"
  | "Windows936"
  | "EUC-CN"
  | "KS_C_5601"
  | "Windows949"
  | "EUC-KR";

export type ResultsetConfigType = {
  header: {
    displayComment: boolean;
    displayType: boolean;
  };
  displayRowno: boolean;
  maxCharactersInCell: number;
  maxRowsInPreview: number;
};

export type DatabaseConfigType = {
  limitRows: number;
};

export type OutputConfigType = {
  maxRows: number;
  maxCharactersInCell: number;
  html: {
    displayToc: boolean;
    displayGraphs: boolean;
  };
};
