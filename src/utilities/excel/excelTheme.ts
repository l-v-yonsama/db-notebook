import * as Excel from "exceljs";
import { ExcelTheme } from "../../types/Config";

type SelectedTheme = Exclude<ExcelTheme, "unspecified">;
type SemanticFill = "added" | "updated" | "deleted" | "warning" | "error";
type DataRange = { firstRow: number; lastRow: number; firstCol: number; lastCol: number };
type SqlBlock = { headingRow: number; firstRow: number; lastRow: number; firstCol: number };

const DATA_RANGES = new WeakMap<Excel.Worksheet, DataRange[]>();
const SQL_BLOCKS = new WeakMap<Excel.Worksheet, SqlBlock[]>();

export function registerExcelThemeDataRange(sheet: Excel.Worksheet, range: DataRange): void {
  if (range.lastRow < range.firstRow || range.lastCol < range.firstCol) {
    return;
  }
  const ranges = DATA_RANGES.get(sheet) ?? [];
  ranges.push(range);
  DATA_RANGES.set(sheet, ranges);
}

export function registerExcelThemeSqlBlock(sheet: Excel.Worksheet, block: SqlBlock): void {
  if (block.lastRow < block.firstRow) {
    return;
  }
  const blocks = SQL_BLOCKS.get(sheet) ?? [];
  blocks.push(block);
  SQL_BLOCKS.set(sheet, blocks);
}

type Palette = {
  surface: string;
  text: string;
  header: string;
  headerText: string;
  accent: string;
  added: string;
  updated: string;
  deleted: string;
  warning: string;
  error: string;
};

// A workbook uses the fonts of the computer that opens it. For local output,
// select one font family per theme on Windows and macOS only.
const THEME_FONTS: Record<"win32" | "darwin", Record<SelectedTheme, string | undefined>> = {
  win32: {
    light: "Arial",
    warm: "Georgia",
    slate: "Segoe UI",
    sage: "Segoe UI",
    midnight: "Consolas",
    chalkboard: undefined,
    patisserie: undefined,
    roastery: undefined,
  },
  darwin: {
    light: "PT Sans",
    warm: "PT Serif",
    slate: "PT Sans",
    sage: "PT Sans",
    midnight: "PT Mono",
    chalkboard: "PT Sans Narrow",
    patisserie: "PT Sans",
    roastery: "PT Mono",
  },
};

function themeFont(theme: SelectedTheme, platform: NodeJS.Platform): string | undefined {
  if (platform === "win32" || platform === "darwin") {
    return THEME_FONTS[platform][theme];
  }
  return undefined;
}

function withFontName(font: Partial<Excel.Font>, name?: string): Partial<Excel.Font> {
  const result = { ...font };
  if (name === undefined) {
    delete result.name;
  } else {
    result.name = name;
  }
  return result;
}

// Colors mirror the eight HTML themes. Excel colors are opaque ARGB values.
const PALETTES: Record<SelectedTheme, Palette> = {
  light: {
    surface: "FFFFFFFF",
    text: "FF30343A",
    header: "FF356B91",
    headerText: "FFFFFFFF",
    accent: "FF356B91",
    added: "FFDFF0D8",
    updated: "FFD9EDF7",
    deleted: "FFF2DEDE",
    warning: "FFFCF8E3",
    error: "FFFF8E8E",
  },
  warm: {
    surface: "FFFAF6EF",
    text: "FF38291F",
    header: "FFAA482F",
    headerText: "FFFFFFFF",
    accent: "FFAA482F",
    added: "FFDFF0D8",
    updated: "FFD9EDF7",
    deleted: "FFF2DEDE",
    warning: "FFFCF8E3",
    error: "FFFF8E8E",
  },
  slate: {
    surface: "FFF3F7FA",
    text: "FF24364A",
    header: "FF356B91",
    headerText: "FFFFFFFF",
    accent: "FF356B91",
    added: "FFDFF0D8",
    updated: "FFD9EDF7",
    deleted: "FFF2DEDE",
    warning: "FFFCF8E3",
    error: "FFFF8E8E",
  },
  sage: {
    surface: "FFF4F7F1",
    text: "FF263A30",
    header: "FF356D55",
    headerText: "FFFFFFFF",
    accent: "FF356D55",
    added: "FFDFF0D8",
    updated: "FFD9EDF7",
    deleted: "FFF2DEDE",
    warning: "FFFCF8E3",
    error: "FFFF8E8E",
  },
  midnight: {
    surface: "FF151B23",
    text: "FFE9EDF2",
    header: "FF3B4B5B",
    headerText: "FFE9EDF2",
    accent: "FF7BB9D3",
    added: "FF274735",
    updated: "FF29475A",
    deleted: "FF60383E",
    warning: "FF5E4E2B",
    error: "FF73383B",
  },
  chalkboard: {
    surface: "FF1F2A26",
    text: "FFF3EED9",
    header: "FF596B5D",
    headerText: "FFF3EED9",
    accent: "FFD4B776",
    added: "FF2C5039",
    updated: "FF2B4B54",
    deleted: "FF613D40",
    warning: "FF62542E",
    error: "FF743A3B",
  },
  patisserie: {
    surface: "FFFFF8EF",
    text: "FF4C2735",
    header: "FFAA5264",
    headerText: "FFFFFFFF",
    accent: "FFAA5264",
    added: "FFDFF0D8",
    updated: "FFD9EDF7",
    deleted: "FFF2DEDE",
    warning: "FFFCF8E3",
    error: "FFFF8E8E",
  },
  roastery: {
    surface: "FF231813",
    text: "FFF6E5CA",
    header: "FF6B4A35",
    headerText: "FFF6E5CA",
    accent: "FFE5AA70",
    added: "FF394731",
    updated: "FF324758",
    deleted: "FF633A3A",
    warning: "FF62502C",
    error: "FF713837",
  },
};

const LEGACY_FILLS: Record<string, SemanticFill> = {
  FFDFF0D8: "added",
  FFD9EDF7: "updated",
  FFF2DEDE: "deleted",
  FFFCF8E3: "warning",
  FFFF8E8E: "error",
};

const solidFill = (argb: string): Excel.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

function addHeadingBorder(cell: Excel.Cell, color: string, leftEdge: boolean): void {
  cell.border = {
    ...cell.border,
    bottom: { style: "thin", color: { argb: color } },
    ...(leftEdge ? { left: { style: "medium", color: { argb: color } } } : {}),
  };
}

function headingWidth(text: string, fontSize: number): number {
  const characters = Array.from(text).reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0
  );
  return Math.max(28, characters * (fontSize / 11) + 6);
}

function styleHeadingBand(
  sheet: Excel.Worksheet,
  heading: Excel.Cell,
  palette: Palette,
  fill: Excel.Fill,
  borderColor: string,
  fontName?: string
): number {
  const widthNeeded = headingWidth(String(heading.value), heading.font.size ?? 11);
  let width = 0;
  let styledCells = 0;

  const firstColumn = heading.fullAddress.col;
  let lastColumn = firstColumn - 1;
  for (let col = firstColumn; col < firstColumn + 12; col++) {
    const cell = sheet.getCell(heading.row, col);
    if (col !== firstColumn && (cell.value !== null || cell.isMerged)) {
      break;
    }
    cell.fill = fill;
    cell.font = { ...withFontName(cell.font ?? {}, fontName), color: { argb: palette.headerText } };
    addHeadingBorder(cell, borderColor, col === firstColumn);
    lastColumn = col;
    width += sheet.getColumn(col).width ?? sheet.properties.defaultColWidth ?? 8.43;
    styledCells++;
    if (styledCells >= 3 && width >= widthNeeded) {
      break;
    }
  }
  return lastColumn;
}

export function applyExcelTheme(
  workbook: Excel.Workbook,
  theme: ExcelTheme,
  platform: NodeJS.Platform = process.platform
): void {
  if (theme === "unspecified") {
    return;
  }

  const palette = PALETTES[theme];
  const fontName = themeFont(theme, platform);
  const borderColor =
    theme === "midnight" || theme === "chalkboard" || theme === "roastery"
      ? palette.accent
      : palette.text;
  const fills = {
    surface: solidFill(palette.surface),
    header: solidFill(palette.header),
    added: solidFill(palette.added),
    updated: solidFill(palette.updated),
    deleted: solidFill(palette.deleted),
    warning: solidFill(palette.warning),
    error: solidFill(palette.error),
  };

  workbook.eachSheet((sheet) => {
    sheet.properties.tabColor = { argb: palette.accent };
    for (const range of DATA_RANGES.get(sheet) ?? []) {
      for (let row = range.firstRow; row <= range.lastRow; row++) {
        for (let col = range.firstCol; col <= range.lastCol; col++) {
          const cell = sheet.getCell(row, col);
          if (cell.value !== null) {
            continue;
          }
          const existingFill =
            cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb?.toUpperCase() : undefined;
          const semanticFill = existingFill ? LEGACY_FILLS[existingFill] : undefined;
          cell.fill = semanticFill ? fills[semanticFill] : fills.surface;
        }
      }
    }
    const headings: Excel.Cell[] = [];
    // UNDO_CHANGES has header cells with a fill but no value (C/D in each title row).
    const cellIteration = { includeEmpty: sheet.name === "UNDO_CHANGES" };
    sheet.eachRow((row) => {
      const headerColumns = new Set<number>();
      row.eachCell(cellIteration, (cell) => {
        if (
          cell.fill?.type === "pattern" &&
          cell.fill.fgColor?.argb?.toUpperCase() === "FF444444"
        ) {
          headerColumns.add(cell.fullAddress.col);
        }
      });
      row.eachCell(cellIteration, (cell) => {
        const existingFill =
          cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb?.toUpperCase() : undefined;
        const isHeader = existingFill === "FF444444";
        const semanticFill = existingFill ? LEGACY_FILLS[existingFill] : undefined;
        if (cell.value === null && !isHeader && !semanticFill) {
          return;
        }
        cell.fill = isHeader ? fills.header : semanticFill ? fills[semanticFill] : fills.surface;

        const value = cell.value;
        const isLink = value !== null && typeof value === "object" && "hyperlink" in value;
        const isHeading =
          typeof value === "string" && (value.startsWith("■ ") || /^\[[^\]]+\]$/.test(value));
        const originalFont = cell.font ?? {};
        const isLargeTitle = typeof value === "string" && (originalFont.size ?? 0) >= 18;
        if ((isHeading || isLargeTitle) && cell.fullAddress.col <= 3) {
          headings.push(cell);
        }
        const textColor = isHeader
          ? palette.headerText
          : isLink || isHeading || isLargeTitle
          ? palette.accent
          : palette.text;
        cell.font = {
          ...withFontName(originalFont, fontName),
          color: { argb: textColor },
          ...(isHeading || isLargeTitle ? { bold: true } : {}),
          ...((theme === "chalkboard" || theme === "patisserie") && (isHeading || isLargeTitle)
            ? { italic: true }
            : {}),
        };
        if (isHeader) {
          addHeadingBorder(cell, borderColor, !headerColumns.has(cell.fullAddress.col - 1));
        }

        if (value !== null && typeof value === "object" && "richText" in value) {
          cell.value = {
            richText: value.richText.map((run) =>
              run.font
                ? {
                    ...run,
                    font: { ...withFontName(run.font, fontName), color: { argb: palette.accent } },
                  }
                : run
            ),
          };
        }
      });
    });
    const headingEnds = new Map<number, number>();
    headings.forEach((heading) => {
      headingEnds.set(
        heading.fullAddress.row,
        styleHeadingBand(sheet, heading, palette, fills.header, borderColor, fontName)
      );
    });
    for (const block of SQL_BLOCKS.get(sheet) ?? []) {
      const lastCol = headingEnds.get(block.headingRow);
      if (lastCol === undefined) {
        continue;
      }
      for (let row = block.firstRow; row <= block.lastRow; row++) {
        for (let col = block.firstCol; col <= lastCol; col++) {
          const cell = sheet.getCell(row, col);
          if (cell.value === null && !cell.isMerged) {
            cell.fill = fills.surface;
          }
        }
      }
    }
  });
}
