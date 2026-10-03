import {
  AnnotationType,
  GeneralColumnType,
  isDateTimeOrDate,
  toDate,
} from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import * as Excel from "exceljs";

// Common cell value / border / date / image formatting helpers shared by every
// workbook generator under src/utilities/excel/.

export type HorizontalType =
  | "fill"
  | "left"
  | "center"
  | "right"
  | "justify"
  | "centerContinuous"
  | "distributed";

interface IHyperLink {
  title: string;
  address: string;
}

export type CellStyleOptionsParams = {
  annotationMessage?: any;
  resolvedLabel?: string;
  isHyperText?: boolean;
  hyperLinkAddr?: string;
  wrap?: boolean;
  horizontal?: HorizontalType;
  fontSize?: number;
  format?: CellFormat;
};

export enum CellFormat {
  // time = 'hh:mm:ss',
  date = "yyyy/mm/dd",
  dateTime = "yyyy/mm/dd hh:mm:ss",
  decimal = "#,##0",
  floatPercent = "0.00%",
}

export function setTableHeaderCell(
  cell: Excel.Cell,
  options?: {
    horizontal?: HorizontalType;
  }
) {
  cell.alignment = {
    vertical: "middle",
    horizontal: options?.horizontal ?? "center",
  };
  cell.font = { color: { argb: "00ffffff" } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF444444" },
  };
}

export function fillCell(cell: Excel.Cell, type: AnnotationType) {
  let fgColor: string | undefined;

  switch (type) {
    case "Add":
      // GitHub diff: green
      fgColor = "FFDFF0D8";
      break;
    case "Upd":
      // GitHub diff: blue
      fgColor = "FFD9EDF7";
      break;
    case "Del":
      // GitHub diff: red
      fgColor = "FFF2DEDE";
      break;
    case "Err":
      fgColor = "FFFF8E8E";
      break;
  }

  if (fgColor) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fgColor },
    };
  }
}

export function getCellFormat(type: GeneralColumnType): CellFormat | undefined {
  if (isDateTimeOrDate(type)) {
    return GeneralColumnType.DATE === type ? CellFormat.date : CellFormat.dateTime;
  }
  // if(GeneralColumnType.TIME === type){
  //   return CellFormat.time;
  // }
  return undefined;
}

export function setAnyValueByIndex(cell: Excel.Cell, text: any, options?: CellStyleOptionsParams) {
  let cellValue: Excel.CellValue = text;
  if (options) {
    if (options.isHyperText === true) {
      cellValue = {
        text: text,
        hyperlink: options.hyperLinkAddr ? options.hyperLinkAddr : text,
      };
      cell.font = { color: { argb: "004e47cc" } };
    }
    if (options.wrap || options.horizontal) {
      cell.alignment = {};
      if (options.wrap) {
        cell.alignment.wrapText = true;
      }
      if (options.horizontal) {
        cell.alignment.horizontal = options.horizontal;
      }
    }
    if (options.fontSize) {
      cell.font = {
        size: options.fontSize,
      };
    }
    let useFormat = !!options.format;
    if (
      options.annotationMessage !== undefined ||
      options.resolvedLabel !== undefined
    ) {
      cellValue = {
        richText: [],
      };
      let me = text ?? "";
      let you = options.annotationMessage ?? "";
      // 比較対象も横並びにする場合は標準型のまま
      if (options.format) {
        if (options.format === CellFormat.date || options.format === CellFormat.dateTime) {
          me = toDateString(me, options.format);
          if (options.annotationMessage) {
            you = toDateString(you, options.format);
          }
        }
      }
      cellValue.richText.push({
        text: me,
      });
      if (options.annotationMessage !== undefined) {
        cellValue.richText.push({
          text: `\n[${you}]`,
          font: {
            color: {
              argb: "66333366",
            },
          },
        });
      }
      if (options.resolvedLabel) {
        cellValue.richText.push({
          text: `\n<${options.resolvedLabel}>`,
          font: {
            color: {
              argb: "33336666",
            },
          },
        });
      }
      useFormat = false;
    }
    if (useFormat && options.format) {
      cell.numFmt = options.format;
      if (options.format === CellFormat.date || options.format === CellFormat.dateTime) {
        cellValue = convertToLocalTimezoneDate(text);
      }
    }
  }
  cell.value = cellValue;
}

function toDateString(target: any, format: CellFormat): string {
  if (target === undefined || target === null || target.length === 0) {
    return "";
  }
  var d = toDate(target)?.toUTCString();
  return dayjs(d)
    .add(dayjs().utcOffset(), "minute")
    .format(format === CellFormat.date ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss");
}

function setBorders(sheet: Excel.Worksheet, rs: number, re: number, cs: number, ce: number) {
  for (let c = cs; c <= ce; c++) {
    for (let r = rs; r <= re; r++) {
      sheet.getCell(r, c).border = {
        top: { style: "dashDot", color: { argb: "FF5555FF" } },
        left: { style: "dashDot", color: { argb: "FF5555FF" } },
        bottom: { style: "dashDot", color: { argb: "FF5555FF" } },
        right: { style: "dashDot", color: { argb: "FF5555FF" } },
      };
    }
  }
}

export function addImageInSheet(
  workbook: Excel.Workbook,
  sheet: Excel.Worksheet,
  base64: string,
  extension: "jpeg" | "png" | "gif",
  range: { editAs?: string } & Excel.ImageRange
) {
  // add image to workbook by base64
  let imageId = workbook.addImage({
    base64,
    extension,
  });
  // insert an image
  sheet.addImage(imageId, range);
}

function nvl(s: string | undefined, rep: string) {
  if (s === undefined) {
    return rep;
  }
  return s;
}

function convertToLocalTimezoneDate(e: Date | undefined | null): Date | undefined | null {
  if (e === null || e === undefined) {
    return e;
  }
  return dayjs(toDate(e.toUTCString())).add(dayjs().utcOffset(), "minute").toDate();
}

export function getImageTypeFromContentType(
  contentType: string | undefined
): "jpeg" | "png" | "gif" | undefined {
  if (contentType === undefined) {
    return undefined;
  }
  switch (contentType.toLocaleLowerCase()) {
    case "image/jpg":
    case "image/jpeg":
      return "jpeg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
  }
  return undefined;
}

