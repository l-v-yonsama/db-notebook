import * as Excel from "exceljs";
import { describe, expect, it } from "vitest";
import { fillCell, setTableHeaderCell } from "../../../src/utilities/excel/cellStyle";
import {
  applyExcelTheme,
  registerExcelThemeDataRange,
  registerExcelThemeSqlBlock,
} from "../../../src/utilities/excel/excelTheme";

describe("applyExcelTheme", () => {
  it("暗色テーマでも見出し・差分・警告を区別できる色にする", () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("diff");
    const header = sheet.getCell("A1");
    header.value = "ID";
    setTableHeaderCell(header);

    const added = sheet.getCell("A2");
    added.value = "new";
    fillCell(added, "Add");
    const warning = sheet.getCell("A3");
    warning.value = "rule";
    fillCell(warning, "Rul");

    applyExcelTheme(book, "roastery");

    expect(header.fill).toMatchObject({ fgColor: { argb: "FF6B4A35" } });
    expect(header.font.color?.argb).toBe("FFF6E5CA");
    expect(added.fill).toMatchObject({ fgColor: { argb: "FF394731" } });
    expect(warning.fill).toMatchObject({ fgColor: { argb: "FF62502C" } });
    expect(added.font.color?.argb).toBe("FFF6E5CA");
  });

  it("見出しの背景色と下線を文字幅に合わせて空きセルへ広げ、次の値の手前で止める", () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("result");
    const heading = sheet.getCell("B2");
    heading.value = "■ A fairly long table heading with many details";
    sheet.getCell("H2").value = "Other value";

    applyExcelTheme(book, "slate", "win32");

    expect(heading.fill).toMatchObject({ fgColor: { argb: "FF356B91" } });
    expect(heading.font.color?.argb).toBe("FFFFFFFF");
    expect(heading.border.left?.style).toBe("medium");
    expect(heading.border.left?.color?.argb).toBe("FF24364A");
    for (const address of ["C2", "D2", "E2", "F2", "G2"]) {
      const cell = sheet.getCell(address);
      expect(cell.value).toBeNull();
      expect(cell.fill).toMatchObject({ fgColor: { argb: "FF356B91" } });
      expect(cell.border.bottom?.style).toBe("thin");
      expect(cell.border.bottom?.color?.argb).toBe("FF24364A");
      expect(cell.border.left).toBeUndefined();
    }
    expect(sheet.getCell("H2").value).toBe("Other value");
    expect(sheet.getCell("H2").fill).toMatchObject({ fgColor: { argb: "FFF3F7FA" } });
  });

  it("短い見出しは最低3セル分を塗り、結合セルは変更しない", () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("result");
    sheet.getColumn("B").width = 20;
    sheet.getColumn("C").width = 20;
    sheet.getColumn("D").width = 20;
    sheet.getCell("B2").value = "■ ID";
    sheet.mergeCells("E2:F2");

    applyExcelTheme(book, "warm", "darwin");

    expect(sheet.getCell("D2").fill).toMatchObject({ fgColor: { argb: "FFAA482F" } });
    expect(sheet.getCell("E2").isMerged).toBe(true);
    expect(sheet.getCell("E2").fill?.fgColor?.argb).not.toBe("FFAA482F");
  });

  it("SQL行の背景を対応する表見出しと同じ列まで広げ、次の行や列は塗らない", async () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("diff");
    for (const [headingRow, firstRow, lines, heading] of [
      [1, 3, ["SELECT", "FROM EMP"], "■ EMP"],
      [19, 21, ["SELECT", "*", "FROM testtable"], "■ testtable (table with various data types)"],
    ] as const) {
      sheet.getCell(headingRow, 1).value = heading;
      const label = sheet.getCell(firstRow, 1);
      label.value = "SQL";
      setTableHeaderCell(label);
      sheet.mergeCells(firstRow, 1, firstRow + lines.length - 1, 1);
      lines.forEach((line, index) => {
        sheet.getCell(firstRow + index, 2).value = line;
      });
      registerExcelThemeSqlBlock(sheet, {
        headingRow,
        firstRow,
        lastRow: firstRow + lines.length - 1,
        firstCol: 1,
      });
    }

    applyExcelTheme(book, "roastery", "darwin");
    const reopened = new Excel.Workbook();
    await reopened.xlsx.load(await book.xlsx.writeBuffer());
    const result = reopened.getWorksheet("diff")!;
    for (const [headingRow, firstRow, lastRow] of [
      [1, 3, 4],
      [19, 21, 23],
    ]) {
      let lastHeadingCol = 1;
      while (result.getCell(headingRow, lastHeadingCol + 1).fill?.fgColor?.argb === "FF6B4A35") {
        lastHeadingCol++;
      }
      expect(lastHeadingCol).toBeGreaterThan(2);
      for (let row = firstRow; row <= lastRow; row++) {
        for (let col = 2; col <= lastHeadingCol; col++) {
          expect(result.getCell(row, col).fill?.fgColor?.argb).toBe("FF231813");
        }
        expect(result.getCell(row, lastHeadingCol + 1).fill?.fgColor?.argb).toBeUndefined();
      }
      expect(result.getCell(lastRow + 1, 2).fill?.fgColor?.argb).toBeUndefined();
      expect(result.getCell(firstRow, 1).fill?.fgColor?.argb).toBe("FF231813");
    }
    expect(result.getCell("B23").value).toBe("FROM testtable");
  });

  it("連続する表ヘッダーに左端と下部の罫線を付ける", () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("result");
    const first = sheet.getCell("C4");
    const second = sheet.getCell("D4");
    first.value = "ID";
    second.value = "Name";
    setTableHeaderCell(first);
    setTableHeaderCell(second);

    applyExcelTheme(book, "midnight", "linux");

    expect(first.border.left?.style).toBe("medium");
    expect(first.border.bottom?.style).toBe("thin");
    expect(second.border.left).toBeUndefined();
    expect(second.border.bottom?.style).toBe("thin");
  });

  it("UNDO_CHANGESの空白ヘッダーセルもテーマ色に変え、テーマ未指定なら黒背景を残す", async () => {
    const makeBook = () => {
      const book = new Excel.Workbook();
      const sheet = book.addWorksheet("UNDO_CHANGES");
      for (const address of ["B3", "C3", "D3"]) {
        setTableHeaderCell(sheet.getCell(address));
      }
      sheet.getCell("B3").value = "-- 1:EMP";
      return book;
    };

    const themed = makeBook();
    applyExcelTheme(themed, "warm", "darwin");
    const saved = await themed.xlsx.writeBuffer();
    const reopened = new Excel.Workbook();
    await reopened.xlsx.load(saved);
    const sheet = reopened.getWorksheet("UNDO_CHANGES")!;
    for (const address of ["B3", "C3", "D3"]) {
      expect(sheet.getCell(address).fill).toMatchObject({ fgColor: { argb: "FFAA482F" } });
      expect(sheet.getCell(address).border.bottom?.style).toBe("thin");
    }

    const unspecified = makeBook();
    applyExcelTheme(unspecified, "unspecified", "darwin");
    expect(unspecified.getWorksheet("UNDO_CHANGES")!.getCell("C3").fill).toMatchObject({
      fgColor: { argb: "FF444444" },
    });
  });

  it("データ列の値が見出しの文字列に似ていても帯を広げない", () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("result");
    sheet.getCell("G5").value = "■ A value in a data column";

    applyExcelTheme(book, "sage", "darwin");

    expect(sheet.getCell("H5").fill?.fgColor?.argb).toBeUndefined();
    expect(sheet.getCell("G5").fill).toMatchObject({ fgColor: { argb: "FFF4F7F1" } });
  });

  it("表のデータ範囲内だけNULLセルを塗り、差分色と範囲外の空白を維持する", async () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("result");
    sheet.getCell("B2").value = 1;
    sheet.getCell("D2").value = "first";
    sheet.getCell("B3").value = 2;
    sheet.getCell("D3").value = "second";
    fillCell(sheet.getCell("C3"), "Upd");
    registerExcelThemeDataRange(sheet, {
      firstRow: 2,
      lastRow: 4,
      firstCol: 2,
      lastCol: 4,
    });

    applyExcelTheme(book, "roastery", "darwin");

    const reopened = new Excel.Workbook();
    await reopened.xlsx.load(await book.xlsx.writeBuffer());
    const result = reopened.getWorksheet("result")!;
    expect(result.getCell("C2").value).toBeNull();
    expect(result.getCell("C2").fill).toMatchObject({ fgColor: { argb: "FF231813" } });
    expect(result.getCell("C3").fill).toMatchObject({ fgColor: { argb: "FF324758" } });
    expect(result.getCell("B4").value).toBeNull();
    expect(result.getCell("B4").fill).toMatchObject({ fgColor: { argb: "FF231813" } });
    expect(result.getCell("E2").fill?.fgColor?.argb).toBeUndefined();
    expect(result.getCell("C5").fill?.fgColor?.argb).toBeUndefined();
  });

  it("テーマ未指定ならデータ範囲のNULLセルを塗らない", () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("result");
    sheet.getCell("B2").value = 1;
    registerExcelThemeDataRange(sheet, {
      firstRow: 2,
      lastRow: 2,
      firstCol: 2,
      lastCol: 3,
    });

    applyExcelTheme(book, "unspecified", "darwin");

    expect(sheet.getCell("C2").fill?.fgColor?.argb).toBeUndefined();
  });

  it.each([
    ["win32", "light", "Arial"],
    ["win32", "warm", "Georgia"],
    ["win32", "slate", "Segoe UI"],
    ["win32", "sage", "Segoe UI"],
    ["win32", "midnight", "Consolas"],
    ["win32", "chalkboard", undefined],
    ["win32", "patisserie", undefined],
    ["win32", "roastery", undefined],
    ["darwin", "light", "PT Sans"],
    ["darwin", "warm", "PT Serif"],
    ["darwin", "slate", "PT Sans"],
    ["darwin", "sage", "PT Sans"],
    ["darwin", "midnight", "PT Mono"],
    ["darwin", "chalkboard", "PT Sans Narrow"],
    ["darwin", "patisserie", "PT Sans"],
    ["darwin", "roastery", "PT Mono"],
    ["linux", "light", undefined],
    ["linux", "chalkboard", undefined],
    ["linux", "roastery", undefined],
  ] as const)("%s の %s テーマではフォントを %s にする", (platform, theme, fontName) => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("menu");
    const heading = sheet.getCell("A1");
    heading.value = "■ Cafe menu";
    heading.font = { name: "Arial", size: 24 };
    const body = sheet.getCell("A2");
    body.value = "Espresso 450";
    body.font = { name: "Arial", size: 12 };

    applyExcelTheme(book, theme, platform);

    expect(heading.font.name).toBe(fontName);
    expect(body.font.name).toBe(fontName);
    expect(heading.font.size).toBe(24);
    expect(body.font.size).toBe(12);
  });

  it("テーマ未指定時はフォント名を指定せず、色も変えない", () => {
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet("menu");
    const title = sheet.getCell("A1");
    title.value = "■ Cafe menu";
    title.font = { size: 24, bold: true };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF444444" } };
    const rich = sheet.getCell("A2");
    rich.value = { richText: [{ text: "Espresso", font: { bold: true } }] };

    applyExcelTheme(book, "unspecified", "darwin");

    expect(title.font).toMatchObject({ size: 24, bold: true });
    expect(title.font.name).toBeUndefined();
    expect(title.fill).toMatchObject({ fgColor: { argb: "FF444444" } });
    const richValue = rich.value as Excel.CellRichTextValue;
    expect(richValue.richText[0].font).toMatchObject({ bold: true });
    expect(richValue.richText[0].font?.name).toBeUndefined();
  });

  it("フォント未指定のテーマでもリッチテキストのフォント名を残さない", () => {
    const book = new Excel.Workbook();
    const rich = book.addWorksheet("menu").getCell("A1");
    rich.value = { richText: [{ text: "Espresso", font: { name: "PT Mono", bold: true } }] };

    applyExcelTheme(book, "roastery", "win32");

    const richValue = rich.value as Excel.CellRichTextValue;
    expect(richValue.richText[0].font).toMatchObject({ bold: true });
    expect(richValue.richText[0].font?.name).toBeUndefined();
  });
});
