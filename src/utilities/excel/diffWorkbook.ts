import { getRecordRuleResults } from "@l-v-yonsama/multi-platform-database-drivers";
import {
  DiffResult,
  GeneralColumnType,
  RdhKey,
  RecordRuleValidationResult,
  ResultSetData,
  RowHelper,
  RuleAnnotation,
  CodeResolvedAnnotation,
  UpdateAnnotation,
} from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import { EnumValues } from "enum-values";
import * as Excel from "exceljs";
import { getOutputConfig, getResultsetConfig } from "../configUtil";
import { fillCell, getCellFormat, setAnyValueByIndex, setTableHeaderCell, toRuleMarker } from "./cellStyle";
import { BookCreateOption, createCommonHeader, FONT_NAME_COMIC_SANS_MS, writeTocRecords } from "./common";
import { createRecordRulesSheet, createUndoChangeSheet } from "./recordRuleSheet";

function rowCellStringLabel(row: number, col?: number): string {
  let s = `${row} row${row === 1 ? "" : "s"}`;
  if (col !== undefined) {
    s += ` (${col} col${col === 1 ? "" : "s"})`;
  }
  return s;
}

export async function createBookFromDiffList(
  list: {
    title: string;
    rdh1: ResultSetData;
    rdh2: ResultSetData;
    diffResult: DiffResult;
    undoChangeStatements?: string[];
  }[],
  targetExcelPath: string,
  options?: BookCreateOption
): Promise<string> {
  let errorMessage = "";
  var workbook = new Excel.Workbook();
  const displayOnlyChanged = options?.diff?.displayOnlyChanged === true;
  const rdhConfig = getResultsetConfig();
  const outputCondig = getOutputConfig();

  try {
    // TOC
    let tocSheet: Excel.Worksheet | undefined = undefined;
    if (outputCondig.excel.displayToc) {
      tocSheet = workbook.addWorksheet("TOC", {
        pageSetup: {
          paperSize: 9,
          orientation: "portrait",
          margins: {
            left: 0.5,
            right: 0.5,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
          },
        },
      });
      createCommonHeader(tocSheet);
      tocSheet.getColumn("A").width = 2;
      tocSheet.getColumn("B").width = 2;
      tocSheet.getColumn("C").width = 4;
      tocSheet.getColumn("D").width = 20;
      tocSheet.getColumn("E").width = 16;
      tocSheet.getColumn("H").width = 16;
    }

    let tocRowNo = 3;
    let cell: Excel.Cell;
    if (outputCondig.excel.displayToc) {
      cell = tocSheet!.getCell(`C${tocRowNo}`);
      cell.value = "Table of contents.";
      cell.font = { name: FONT_NAME_COMIC_SANS_MS, size: 24 };
    }

    tocRowNo += 4;

    // RESULTSETS
    const diffList = list;
    const beforeSheet = workbook.addWorksheet("before", {
      pageSetup: { paperSize: 9, orientation: "portrait" },
    });
    const afterSheet = workbook.addWorksheet("after", {
      pageSetup: { paperSize: 9, orientation: "portrait" },
    });

    let pairList: {
      rowNo: number;
      rdh: ResultSetData | undefined;
      sheet: Excel.Worksheet;
      tableRowNoList: number[];
    }[] = [
      { rowNo: 1, rdh: undefined, sheet: beforeSheet, tableRowNoList: [] },
      { rowNo: 1, rdh: undefined, sheet: afterSheet, tableRowNoList: [] },
    ];

    const beforeDate = diffList.map((it) => it.rdh1.created).find((it) => it !== undefined);
    const afterDate = diffList.map((it) => it.rdh2.created).find((it) => it !== undefined);

    if (outputCondig.excel.displayToc) {
      tocSheet!.getCell("H4").value = "Before time:";
      tocSheet!.getCell("H4").alignment = {
        horizontal: "right",
      };
      tocSheet!.mergeCells("H4:I4");
      tocSheet!.getCell("H5").value = "After  time:";
      tocSheet!.getCell("H5").alignment = {
        horizontal: "right",
      };
      tocSheet!.mergeCells("H5:I5");
      tocSheet!.getCell("J4").value = `${dayjs(beforeDate).format("HH:mm:ss")}`;
      tocSheet!.getCell("J5").value = `${dayjs(afterDate).format("HH:mm:ss")}`;

      // RESULTSETS
      cell = tocSheet!.getCell(`C${tocRowNo}`);
      cell.value = "■ Resultsets";
      tocRowNo++;
      // header
      [
        "No",
        "Title(Table)",
        "comment",
        "Inserted",
        "Deleted",
        "Updated",
        "Link to",
        "Link to",
      ].forEach((title, idx) => {
        const cell = tocSheet!.getCell(tocRowNo, 3 + idx);
        cell.value = title;
        setTableHeaderCell(cell);
      });
      tocSheet!.mergeCells(`I${tocRowNo}:J${tocRowNo}`);

      tocRowNo++;
    }

    diffList.forEach((item, idx) => {
      const no = idx + 1;
      const { rdh1, rdh2, title, diffResult } = item;
      pairList[0].rdh = rdh1;
      pairList[1].rdh = rdh2;

      if (outputCondig.excel.displayToc) {
        tocSheet!.getCell(`C${tocRowNo}`).value = no;
        tocSheet!.getCell(`D${tocRowNo}`).value = title;
        tocSheet!.getCell(`E${tocRowNo}`).value = rdh1.meta.comment ?? "";
        tocSheet!.getCell(`F${tocRowNo}`).value = rowCellStringLabel(diffResult.inserted);
        tocSheet!.getCell(`G${tocRowNo}`).value = rowCellStringLabel(diffResult.deleted);
        tocSheet!.getCell(`H${tocRowNo}`).value = rowCellStringLabel(
          diffResult.updated,
          diffResult.updatedColumns
        );

        tocSheet!.getCell(`I${tocRowNo}`).value = {
          text: "Before" + no,
          hyperlink: `#before!A${pairList[0].rowNo}`,
        };
        tocSheet!.getCell(`J${tocRowNo}`).value = {
          text: "After" + no,
          hyperlink: `#after!A${pairList[1].rowNo}`,
        };
        tocRowNo += 1;
      }

      // create a sheet.
      for (const cur of pairList) {
        const { sheet, rdh } = cur;
        if (!rdh) {
          continue;
        }
        const { tableName, comment, ruleViolationSummary } = rdh.meta;

        cur.tableRowNoList.push(cur.rowNo);
        if (outputCondig.excel.displayTableNameAndStatement) {
          // table name
          const cellTitle = sheet.getCell(cur.rowNo, 1);
          let titleValue = title;
          if (comment) {
            titleValue += ` (${comment})`;
          }
          if (diffResult.message) {
            titleValue += ` [${diffResult.message}]`;
          }
          cellTitle.value = "■ " + titleValue;
          cur.rowNo++;

          // sql statement
          if (rdh.sqlStatement) {
            cur.rowNo++;
            const lines = rdh.sqlStatement.trim().replace(/\r\n/g, "\n").split("\n");
            cell = sheet.getCell(cur.rowNo, 1);
            cell.value = "SQL";
            setTableHeaderCell(cell);
            sheet.mergeCells(`A${cur.rowNo}:A${cur.rowNo + lines.length - 1}`);
            lines.forEach((line) => {
              cell = sheet.getCell(cur.rowNo, 2);
              cell.value = line;
              cur.rowNo++;
            });
            if (rdh.queryConditions?.binds && rdh.queryConditions?.binds.length > 0) {
              cell = sheet.getCell(cur.rowNo, 1);
              cell.value = "BINDS";
              setTableHeaderCell(cell);
              // テーブル見出しの行分もマージするので -1 は不要
              sheet.mergeCells(`A${cur.rowNo}:A${cur.rowNo + rdh.queryConditions?.binds.length}`);

              cell = sheet.getCell(cur.rowNo, 2);
              cell.value = "Position";
              setTableHeaderCell(cell);
              cell = sheet.getCell(cur.rowNo, 3);
              cell.value = "Value";
              setTableHeaderCell(cell);
              cur.rowNo++;
              rdh.queryConditions?.binds.forEach((v, idx) => {
                cell = sheet.getCell(cur.rowNo, 2);
                cell.value = `$${idx + 1}`;
                cell = sheet.getCell(cur.rowNo, 3);
                cell.value = v;
                cur.rowNo++;
              });
            }
            cur.rowNo++;
          }
        } else {
          cur.rowNo++; // for Link to before/after sheet space
        }

        if (ruleViolationSummary) {
          const names = Object.keys(ruleViolationSummary);
          cell = sheet.getCell(cur.rowNo, 1);
          setTableHeaderCell(cell);
          if (names.length === 1) {
            cell.value = `Rule violation`;
            sheet.mergeCells(`B${cur.rowNo}:C${cur.rowNo}`);
          } else {
            cell.value = `Rule violations`;
            sheet.mergeCells(`B${cur.rowNo}:C${cur.rowNo + names.length - 1}`);
          }
          names.forEach((name, idx) => {
            cell = sheet.getCell(cur.rowNo, 3);
            cell.value = `*${idx + 1}: ${name}: ${ruleViolationSummary[name]}`;
            cur.rowNo++;
          });
          cur.rowNo++;
        }

        const startIndex = cur.rowNo;

        const { displayRowno } = rdhConfig;

        if (displayRowno) {
          cell = sheet.getCell(cur.rowNo, 1);
          cell.value = "No";
          setTableHeaderCell(cell);
        }

        rdh.keys.forEach((column: RdhKey, idx: number) => {
          let colBasePos = displayRowno ? 2 : 1;
          const cellPhy = sheet.getCell(startIndex, colBasePos + idx);
          cellPhy.value = column.name;
          setTableHeaderCell(cellPhy);

          if (rdhConfig.header.displayComment) {
            const cellLog = sheet.getCell(startIndex + 1, colBasePos + idx);
            cellLog.value = column.comment;
            setTableHeaderCell(cellLog);
          }

          if (rdhConfig.header.displayType) {
            const rowIdx = rdhConfig.header.displayComment ? startIndex + 2 : startIndex + 1;
            const cellType = sheet.getCell(rowIdx, colBasePos + idx);
            cellType.value = EnumValues.getNameFromValue(GeneralColumnType, column.type);
            setTableHeaderCell(cellType);
          }
        });

        cur.rowNo++;
        if (rdhConfig.header.displayComment && rdhConfig.header.displayType) {
          cur.rowNo += 2;
          if (displayRowno) {
            sheet.mergeCells(`A${startIndex}:A${startIndex + 2}`);
          }
        } else if (rdhConfig.header.displayComment || rdhConfig.header.displayType) {
          cur.rowNo++;
          if (displayRowno) {
            sheet.mergeCells(`A${startIndex}:A${startIndex + 1}`);
          }
        }

        rdh.rows
          .filter(
            (row) => !displayOnlyChanged || RowHelper.hasAnyAnnotation(row, ["Add", "Upd", "Del"])
          )
          .forEach((rdhRow, ri) => {
            const inserted = RowHelper.hasAnnotation(rdhRow, "Add");
            let removed = false;
            let updated = false;
            if (!inserted) {
              removed = RowHelper.hasAnnotation(rdhRow, "Del");
            }
            if (!inserted && !removed) {
              updated = RowHelper.hasAnnotation(rdhRow, "Upd");
            }
            const values = rdhRow.values;
            if (displayRowno) {
              const rowNo = ri + 1;
              let cell = sheet.getCell(cur.rowNo, 1);
              cell.value = rowNo;
              if (inserted) {
                fillCell(cell, "Add");
              } else if (removed) {
                fillCell(cell, "Del");
              } else if (updated) {
                fillCell(cell, "Upd");
              }
            }

            rdh.keys.forEach((column: RdhKey, colIdx: number) => {
              let colBasePos = displayRowno ? 2 : 1;
              let annotationMessage: any = undefined;
              let ruleMarker: string | undefined = undefined;
              let resolvedLabel: string | undefined = undefined;
              let format = getCellFormat(column.type);
              const v = values[column.name];
              const cell = sheet.getCell(cur.rowNo, colBasePos + colIdx);

              const isHyperText = column.meta && column.meta.is_hyperlink === true;
              const ruleAnnonations = RowHelper.filterAnnotationByKeyOf<RuleAnnotation>(
                rdhRow,
                column.name,
                "Rul"
              );
              if (ruleAnnonations.length) {
                ruleMarker = toRuleMarker(ruleViolationSummary, ruleAnnonations);
              }

              if (ruleMarker) {
                fillCell(cell, "Rul");
              }
              if (inserted) {
                fillCell(cell, "Add");
              } else if (removed) {
                // const annotation = rdhRow.getFirstAnnotationsOf(column.name, AnnotationType.Del);
                fillCell(cell, "Del");
                // if (annotation) {
                //   annotationMessage = annotation.options?.result;
                // }
              } else if (updated) {
                const annotation = RowHelper.getFirstAnnotationOf<UpdateAnnotation>(
                  rdhRow,
                  column.name,
                  "Upd"
                );
                if (annotation) {
                  fillCell(cell, "Upd");
                  annotationMessage = annotation.values?.otherValue;
                }
              }

              if (rdh.meta.codeItems) {
                resolvedLabel = RowHelper.getFirstAnnotationOf<CodeResolvedAnnotation>(
                  rdhRow,
                  column.name,
                  "Cod"
                )?.values?.label;
              }

              setAnyValueByIndex(cell, v, {
                annotationMessage,
                isHyperText,
                format,
                ruleMarker,
                resolvedLabel,
              });
            });
            cur.rowNo++;
          });

        cur.rowNo += 2;
      }
    });

    if (outputCondig.excel.enableCrossPairLinks) {
      // 相手テーブルへのリンク作成
      pairList[0].tableRowNoList.forEach((beforeRowNo, idx) => {
        const afterRowNo = pairList[1].tableRowNoList[idx];
        const cell = beforeSheet.getCell(`H${beforeRowNo}`);
        setAnyValueByIndex(cell, "Link to after sheet", {
          isHyperText: true,
          hyperLinkAddr: `#after!A${afterRowNo}`,
        });
      });
      pairList[1].tableRowNoList.forEach((afterRowNo, idx) => {
        const beforeRowNo = pairList[0].tableRowNoList[idx];
        const cell = afterSheet.getCell(`H${afterRowNo}`);
        setAnyValueByIndex(cell, "Link to before sheet", {
          isHyperText: true,
          hyperLinkAddr: `#before!A${beforeRowNo}`,
        });
      });
    }

    // Undo Changes
    const undoList = diffList
      .filter((it) => it.undoChangeStatements !== undefined)
      .map((it) => ({
        title: it.title,
        tableName: it.rdh1.meta.tableName,
        undoChangeStatements: it.undoChangeStatements!,
      }));
    if (undoList.length) {
      // create a sheet.
      tocRowNo += 2;
      if (tocSheet) {
        cell = tocSheet.getCell(`C${tocRowNo}`);
        cell.value = "■ Undo changes";
      }
      tocRowNo++;
      const tocRecords = createUndoChangeSheet(workbook, undoList);
      if (tocSheet) {
        tocRowNo += writeTocRecords(tocSheet, tocRecords, tocRowNo);
      }
    }

    // RECORD RULES
    if (options?.rule?.withRecordRule === true) {
      tocRowNo += 2;
      const ruleResultList = list
        .map((it) => getRecordRuleResults(it.rdh2))
        .filter((it) => it !== undefined) as RecordRuleValidationResult[];
      if (ruleResultList.length) {
        if (tocSheet) {
          cell = tocSheet.getCell(`C${tocRowNo}`);
          cell.value = "■ Record Rules";
        }
        tocRowNo++;
        // create a sheet.
        const tocRecords = createRecordRulesSheet(workbook, ruleResultList);
        if (tocSheet) {
          tocRowNo += writeTocRecords(tocSheet, tocRecords, tocRowNo);
        }
      }
    }

    await workbook.xlsx.writeFile(targetExcelPath);
  } catch (e) {
    if (e instanceof Error) {
      errorMessage = e.message;
    } else {
      errorMessage = "Error:" + e;
    }
  }
  return errorMessage;
}

