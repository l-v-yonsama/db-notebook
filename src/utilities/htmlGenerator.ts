import { prettyTime } from "@l-v-yonsama/multi-platform-database-drivers";
import { abbr, escapeHtml, ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import { promises as fs } from "fs";
import * as path from "path";
import {
  NotebookCell,
  NotebookCellKind,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookDocument,
  TextDocument,
} from "vscode";
import { mediaDir } from "../constant";
import { ExtChartData, ExtChartOptions, PairPlotChartParams } from "../shared/ExtChartJs";
import { DiffTabInnerItem } from "../shared/MessageEventData";
import { RunResultMetadata } from "../shared/RunResultMetadata";
import { CellMeta } from "../types/Notebook";
import { ChartsViewParams } from "../types/views";
import { createChartJsParams, createPairPlotChartParams } from "./chartUtil";
import { getOutputConfig, getToStringParamByConfig } from "./configUtil";
import { writeToResourceOnStorage } from "./fsUtil";
// Re-exported so existing `import { createHtmlFromHarItem } from "./htmlGenerator"` call
// sites keep working after the HAR report logic moved to html/harHtmlGenerator.ts.
export { createHtmlFromHarItem } from "./html/harHtmlGenerator";
export type { MarkdownValues } from "./html/common";
import { createAxiosTocInfoHtml, MarkdownValues } from "./html/common";
import { createResponseBodyMarkdown } from "./httpUtil";
import { logError } from "./logger";
import { isMarkupCell, isMemcachedCell, isRedisCell } from "./notebookUtil";
const PREFIX = "[utilities/htmlGenerator]";

type CreateHtmlOptionsParams = {
  isCellOrigin: boolean;
};

// highlight.js doesn't recognize some of our VS Code-specific cell languageIds
// -- map them to the closest hljs-supported language so the HTML export gets
// real syntax highlighting instead of silently falling back to (often wrong)
// auto-detection. "redis" needs no entry here: the report template registers
// a dedicated hljs "redis" language (see report.html) since bash's keywords
// are lowercase-only and don't match redis-cli's uppercase convention.
const HLJS_LANGUAGE_ALIASES: { [languageId: string]: string } = {
  shellscript: "bash",
  bat: "dos",
};

const toHljsLanguage = (languageId: string): string => HLJS_LANGUAGE_ALIASES[languageId] ?? languageId;

export const createHtmlFromNotebook = async (
  notebook: NotebookDocument,
  fsPath: string
): Promise<string> => {
  return createHtml(notebook.getCells(), fsPath, { isCellOrigin: true });
};

export const createHtmlFromDiffList = async (
  list: DiffTabInnerItem[],
  fsPath: string
): Promise<string> => {
  let htmlContents: string[] = [];
  let errorMessage = "";
  const markdownValues: MarkdownValues = {};
  const outputCondig = getOutputConfig();
  const toHtmlParams = getToStringParamByConfig();
  try {
    const reportFilePath = path.join(mediaDir, "template", "report.html");
    let reportText = await fs.readFile(reportFilePath, { encoding: "utf8" });

    htmlContents = [];
    htmlContents.push(`<nav class="panel">`);
    // TOC
    if (outputCondig.html.displayToc) {
      htmlContents.push(`  <p class="panel-heading" style="padding:10px">TOC</p>`);
      list.forEach((it, idx) => {
        htmlContents.push(
          `  <a class="panel-block cellIdx${idx}" href="#cell${
            idx + 1
          }" style="padding:10px; font-size:small;">`
        );
        const title = createDiffTitle(it);
        htmlContents.push(`    No${idx + 1}:${title}`);

        htmlContents.push(`  </a>`);
      });
      htmlContents.push(`</nav>`);
    }
    reportText = reportText.replace(/<!-- __TOC__ -->/, htmlContents.join("\n"));

    // CONTENTS
    htmlContents = [];
    list.forEach((it, idx) => {
      const { rdh1, rdh2, diffResult } = it;
      htmlContents.push(`<hr class="cellIdx${idx}" />`);
      const id = `id${idx}`;
      htmlContents.push(`<div class="wrapper cellIdx${idx} compact" >`);
      const title = createDiffTitle(it);
      htmlContents.push(
        `<h4 class="title is-4" ><a name="cell${idx + 1}">No${idx + 1}:${title}</a></h4>`
      );

      htmlContents.push(`<div id="${id}" class="block">`);
      htmlContents.push("</div>");
      markdownValues[id] = { lang: "sql", s: rdh1.sqlStatement ?? "" };

      htmlContents.push(`<div class="columns is-mobile">`);
      // before
      htmlContents.push(`<div class="column block" style="overflow:auto;">`);
      htmlContents.push(
        `<div class="notification is-primary is-light" style="padding:10px; margin-bottom:10px;font-size:small;">`
      );
      htmlContents.push(
        `<span class="tag is-primary is-light">Query Result</span> ${escapeHtml(
          rdh1.summary?.info ?? ""
        )}`
      );
      htmlContents.push(`</div>`);
      htmlContents.push(ResultSetDataBuilder.from(rdh1).toHtml(toHtmlParams));
      htmlContents.push(`</div>`);

      // after
      htmlContents.push(`<div class="column block" style="overflow:auto;">`);
      htmlContents.push(
        `<div class="notification is-primary is-light" style="padding:10px; margin-bottom:10px;font-size:small;">`
      );
      htmlContents.push(
        `<span class="tag is-primary is-light">Query Result</span> ${escapeHtml(
          rdh2.summary?.info ?? ""
        )}`
      );
      htmlContents.push(`</div>`);
      htmlContents.push(ResultSetDataBuilder.from(rdh2).toHtml(toHtmlParams));
      htmlContents.push(`</div>`);

      htmlContents.push(`</div>`);
      htmlContents.push(`</div>`);
    });

    reportText = reportText.replace(/<!-- __CONTENTS__ -->/, htmlContents.join("\n"));

    //__FOOTER_CONTENTS__
    htmlContents = [];
    htmlContents.push(`
      <p>
        This report was generated at ${dayjs().format(
          "YYYY-MM-DD HH:mm"
        )} in <a href="https://marketplace.visualstudio.com/items?itemName=HirotakaYoshioka.database-notebook">Database notebook</a>
        <br />
        <small>${fsPath}</small>
      </p>`);
    reportText = reportText.replace(/<!-- __FOOTER_CONTENTS__ -->/, htmlContents.join("\n"));

    //__CUSTOM_SCRIPT__
    htmlContents = [];
    htmlContents.push(`<script>
  var markdownValues = ${JSON.stringify(markdownValues)}
  var chartValues = ${JSON.stringify({})}
  var numOfContents = ${list.length};
  </script>`);
    reportText = reportText.replace(/<!-- __CUSTOM_SCRIPT__ -->/, htmlContents.join("\n"));

    await writeToResourceOnStorage(fsPath, reportText);
  } catch (e) {
    console.error(e);
    logError(`${PREFIX} ${e}`);
    if (e instanceof Error) {
      errorMessage = e.message;
    } else {
      errorMessage = e + "";
    }
  }

  return errorMessage;
};

export const createHtmlFromRdhList = async (
  list: ResultSetData[],
  fsPath: string
): Promise<string> => {
  const toMarkdownConfig = getToStringParamByConfig({
    withCodeLabel: true,
    withRuleViolation: true,
  });

  const cells: NotebookCell[] = [];
  list.forEach((rdh, index) => {
    const runResultMetadata: RunResultMetadata = {
      tableName: rdh.meta.tableName,
      type: rdh.meta.type,
      rdh,
    };

    const outputs: NotebookCellOutput[] = [];
    const title = rdh.meta.command ? "Command Result" : "Query Result";
    outputs.push(
      new NotebookCellOutput(
        [
          NotebookCellOutputItem.text(
            `\`[${title}]\` ${rdh.summary?.info}\n` +
              ResultSetDataBuilder.from(rdh).toMarkdown(toMarkdownConfig),
            "text/markdown"
          ),
        ],
        runResultMetadata
      )
    );

    const cell: any = {
      index,
      kind: NotebookCellKind.Code,
      notebook: null as unknown as NotebookDocument,
      document: {
        languageId: rdh.meta.languageId,
        getText: () => rdh.sqlStatement ?? "",
      } as TextDocument,
      metadata: {} as CellMeta,
      outputs,
      executionSummary: undefined,
    };
    if (rdh.sqlStatement === "" && rdh.meta.queryInput) {
      cell.document.languageId = "json";
      cell.document.getText = () => rdh.meta.queryInput ?? "";
    }
    if (isMemcachedCell(cell) || isRedisCell(cell)) {
      cell.document.getText = () => rdh.meta.command ?? "";
    }

    cells.push(cell);
  });
  return createHtml(cells, fsPath, { isCellOrigin: false });
};

const createHtml = async (
  cells: NotebookCell[],
  fsPath: string,
  options: CreateHtmlOptionsParams
): Promise<string> => {
  const { isCellOrigin } = options;
  let htmlContents: string[] = [];
  let errorMessage = "";
  const markdownValues: MarkdownValues = {};
  const chartValues: { [key: string]: string } = {};
  const outputCondig = getOutputConfig();

  const toHtmlParams = getToStringParamByConfig();

  try {
    const reportFilePath = path.join(mediaDir, "template", "report.html");
    let reportText = await fs.readFile(reportFilePath, { encoding: "utf8" });

    htmlContents = [];
    htmlContents.push(`<nav class="panel">`);
    // TOC
    if (outputCondig.html.displayToc) {
      htmlContents.push(`  <p class="panel-heading" style="padding:10px">TOC</p>`);
      cells.forEach((cell, idx) => {
        htmlContents.push(
          `  <a class="panel-block cellIdx${idx}" href="#cell${
            idx + 1
          }" style="padding:10px; font-size:small;">`
        );
        htmlContents.push(`    ${isCellOrigin ? "CELL" : "No"}${idx + 1} ${getTocInfoHtml(cell)}`);
        htmlContents.push(`  </a>`);
      });
      htmlContents.push(`</nav>`);
    }
    reportText = reportText.replace(/<!-- __TOC__ -->/, htmlContents.join("\n"));

    // CONTENTS
    htmlContents = [];
    cells.forEach((cell, idx) => {
      const cellMeta: CellMeta = cell.metadata;
      const cellLabel = cellMeta.cellLabel;
      const cellTitle = `${isCellOrigin ? "CELL" : "No"}${idx + 1}`;
      htmlContents.push(`<hr class="cellIdx${idx}" />`);
      const id = `id${idx}`;

      htmlContents.push(`<div class="wrapper cellIdx${idx} compact" >`);

      if (cellMeta.publishParams?.topicName) {
        const subscriptionName = cellMeta.publishParams.topicName ?? "";
        htmlContents.push(
          `<h4 class="title is-4" ><a name="cell${idx + 1}">${cellTitle}<span style="padding:10px; font-size:medium;">TOPIC: ${escapeHtml(
            subscriptionName
          )}</span></a></h4>`
        );
      } else {
        htmlContents.push(
          `<h4 class="title is-4" ><a name="cell${idx + 1}">${cellTitle}</a></h4>`
        );
      }
      if (cellLabel) {
        htmlContents.push(`<h5 class="subtitle is-5">${escapeHtml(cellLabel)}</h5>`);
      }
      if (isMarkupCell(cell)) {
        htmlContents.push(`<div id="${id}" class="block">`);
        htmlContents.push("</div>");
        markdownValues[id] = { lang: "Markup", s: escapeHtml(cell.document.getText()) };
      } else {
        htmlContents.push(`<div id="${id}" class="block">`);
        htmlContents.push("</div>");
        markdownValues[id] = {
          lang: toHljsLanguage(cell.document.languageId),
          s: escapeHtml(cell.document.getText()),
        };

        if (
          cell.outputs.some(
            (it) =>
              (it.metadata as RunResultMetadata)?.status === "skipped" &&
              (it.metadata as RunResultMetadata)?.lmResult === undefined
          )
        ) {
          htmlContents.push(
            `<div class="notification is-warning is-light" style="padding:10px; margin-bottom:10px;font-size:small;">Skipped</div>`
          );
        } else {
          cell.outputs.forEach((output, oidx) => {
            output.items.forEach((item) => {
              switch (item.mime) {
                case "text/plain":
                case "application/vnd.code.notebook.stdout":
                  {
                    if (cell.document.languageId !== "sql") {
                      htmlContents.push(`<div class="block">`);
                      htmlContents.push(
                        `<div class="notification is-info is-light" style="padding:10px; margin-bottom:10px;font-size:small; white-space:pre-wrap;">${escapeHtml(
                          item.data.toString()
                        )}</div>`
                      );
                      htmlContents.push("</div>");
                    }
                  }
                  break;
                case "application/vnd.code.notebook.stderr":
                case "application/vnd.code.notebook.error":
                  {
                    htmlContents.push(`<div class="block">`);
                    htmlContents.push(
                      `<div class="notification is-danger is-light" style="padding:10px; margin-bottom:10px; font-size:small; white-space:pre-wrap;">${escapeHtml(
                        item.data.toString()
                      )}</div>`
                    );
                    htmlContents.push("</div>");
                  }
                  break;
              }
            });
            let idx2 = 0;
            if (output.metadata) {
              const metadata: RunResultMetadata = output.metadata;
              if (metadata.rdh) {
                const { rdh } = metadata;
                const title = rdh.meta.command ? "Command Result" : "Query Result";
                htmlContents.push(
                  `<div class="notification is-primary is-light" style="padding:10px; margin-bottom:10px;font-size:small;">`
                );
                htmlContents.push(
                  `<span class="tag is-primary is-light">${title}</span> ${escapeHtml(
                    rdh.summary?.info ?? ""
                  )}`
                );
                htmlContents.push(`</div>`);

                htmlContents.push(ResultSetDataBuilder.from(rdh).toHtml(toHtmlParams));

                // CHART
                if (outputCondig.html.displayGraphs && cellMeta && cellMeta.chart) {
                  const chartId = `id_chart_${idx}_${idx2++}`;
                  const params: ChartsViewParams = { ...cellMeta.chart, rdh };
                  let data: ExtChartData | undefined = undefined;
                  let options: ExtChartOptions | undefined = undefined;
                  let pairPlotChartParams: PairPlotChartParams | undefined = undefined;

                  if (params.type === "pairPlot") {
                    let pairPlotChartIndex = 0;
                    pairPlotChartParams = createPairPlotChartParams(params);
                    htmlContents.push(`<div id="${chartId}" class="block chart">`);

                    htmlContents.push(`  <div class="pair-plot-chart">`);
                    if (pairPlotChartParams.showTitle) {
                      htmlContents.push(`  <p class="title">${escapeHtml(params.title)}</p>`);
                    }
                    if (pairPlotChartParams.hueLegends.length > 0) {
                      htmlContents.push(`  <div class="legends">`);
                      for (const hueLegend of pairPlotChartParams.hueLegends) {
                        htmlContents.push(
                          `    <div class="legend" style="border-color: ${hueLegend.color}; color: ${hueLegend.color};" >`
                        );
                        htmlContents.push(
                          `      ${escapeHtml(hueLegend.pointSymbol)}: ${escapeHtml(
                            hueLegend.title
                          )}`
                        );
                        htmlContents.push(`    </div>`);
                      }
                      htmlContents.push(`  </div>`);
                    }
                    htmlContents.push(`  <table>`);
                    htmlContents.push(`    <tbody>`);
                    htmlContents.push(`      <tr>`);
                    htmlContents.push(`        <th class="rl">&nbsp;</th>`);
                    for (const matrix of pairPlotChartParams.matrix[0]) {
                      htmlContents.push(`        <th>`);
                      htmlContents.push(`          ${escapeHtml(matrix.colName)}`);
                      htmlContents.push(`        </th>`);
                    }
                    htmlContents.push(`      </tr>`);
                    for (const matrixRow of pairPlotChartParams.matrix) {
                      htmlContents.push(`      <tr>`);
                      htmlContents.push(`        <th>`);
                      htmlContents.push(`          <div class="rl">`);
                      htmlContents.push(
                        `            <small>${escapeHtml(matrixRow[0].rowName)}</small>`
                      );
                      htmlContents.push(`          </div>`);
                      htmlContents.push(`        </th>`);
                      for (const matrix of matrixRow) {
                        const pairPlotChartId = `${chartId}_${pairPlotChartIndex++}`;
                        htmlContents.push(`        <td>`);
                        if (matrix.type === "histogram" || matrix.type === "scatter") {
                          htmlContents.push(
                            `<div><canvas id="${pairPlotChartId}" width="150" height="150"></canvas></div>`
                          );
                          chartValues[pairPlotChartId] = escapeHtml(
                            JSON.stringify({
                              type: matrix.type === "histogram" ? "bar" : "scatter",
                              data: matrix.chartParams?.data,
                              options: matrix.chartParams?.options,
                            })
                          );
                        } else {
                          htmlContents.push(
                            `          <div   class="correlation ${matrix.correlation?.category}" >`
                          );
                          htmlContents.push(
                            `            R = ${(matrix.correlation?.value ?? 0).toFixed(2)}`
                          );
                          htmlContents.push(`          </div>`);
                        }
                        htmlContents.push(`        </td>`);
                      }
                      htmlContents.push(`      </tr>`);
                    }
                    htmlContents.push(`    </tbody>`);
                    htmlContents.push(`  </table>`);
                    htmlContents.push(`</div>`);

                    htmlContents.push(`</div>`);
                  } else {
                    const result = createChartJsParams({
                      ...params,
                      showAxis: true,
                      showAxisTitle: true,
                      showLegend: true,
                    });
                    data = result.data;
                    options = result.options;
                    chartValues[chartId] = escapeHtml(
                      JSON.stringify({
                        type: params.type,
                        data,
                        options,
                        pairPlotChartParams,
                      })
                    );
                    htmlContents.push(
                      `<div class="block chart"><canvas id="${chartId}" width="400" height="400"></canvas></div>`
                    );
                  }
                }
              }
              if (metadata.explainRdh) {
                htmlContents.push(
                  ResultSetDataBuilder.from(metadata.explainRdh).toHtml(toHtmlParams)
                );
              }
              if (metadata.analyzedRdh) {
                htmlContents.push(
                  ResultSetDataBuilder.from(metadata.analyzedRdh).toHtml(toHtmlParams)
                );
              }
              if (metadata.axiosEvent) {
                const mdId = `${id}_${idx2++}_md`;
                htmlContents.push(`<div id="${mdId}" class="block">`);
                htmlContents.push("</div>");
                markdownValues[mdId] = {
                  lang: "Markup",
                  s: escapeHtml(
                    createResponseBodyMarkdown(
                      metadata.axiosEvent,
                      outputCondig.maxCharactersInCell
                    )
                  ),
                };
              }
              if (metadata.mqttPublishResult) {
                const { subscription, payloadLength, elapsedTime } = metadata.mqttPublishResult;
                htmlContents.push(
                  `<div class="notification is-primary is-light" style="padding:10px; margin-bottom:10px;font-size:small;">`
                );
                const result = `[Elapsed Time]:${prettyTime(
                  elapsedTime
                )} [Payload Length]:${payloadLength}`;
                htmlContents.push(
                  `<span class="tag is-primary is-light">Result</span> ${escapeHtml(result)}`
                );
                htmlContents.push(`</div>`);
              }
              if (metadata.shellResult) {
                const { ok, message, elapsedTime } = metadata.shellResult;
                htmlContents.push(
                  `<div class="notification ${
                    ok ? "is-success" : "is-danger"
                  } is-light" style="padding:10px; margin-bottom:10px;font-size:small;">`
                );
                htmlContents.push(
                  `<span class="tag ${ok ? "is-success" : "is-danger"} is-light">${
                    ok ? "Success" : "Error"
                  }</span> <span class="tag is-light is-warning">Time:${escapeHtml(
                    prettyTime(elapsedTime)
                  )}</span>` + (message ? ` ${escapeHtml(message)}` : "")
                );
                htmlContents.push(`</div>`);
              }
              if (metadata.lmResult) {
                htmlContents.push(
                  `<div class="notification is-primary is-light" style="padding:10px; margin-bottom:10px;font-size:small;">`
                );
                htmlContents.push(`</div>`);
                const lmId = `lm_id${id}_${oidx}`;
                htmlContents.push(`<div id="${lmId}" class="block">`);
                htmlContents.push("</div>");
                markdownValues[lmId] = {
                  lang: "Markup",
                  s: escapeHtml(metadata.lmResult.markdownText),
                };
              }
            }
          });
        }
      }
      htmlContents.push(`</div>`);
    });

    reportText = reportText.replace(/<!-- __CONTENTS__ -->/, htmlContents.join("\n"));

    //__FOOTER_CONTENTS__
    htmlContents = [];
    htmlContents.push(`
            <p>
              This report was generated at ${dayjs().format(
                "YYYY-MM-DD HH:mm"
              )} in <a href="https://marketplace.visualstudio.com/items?itemName=HirotakaYoshioka.database-notebook">Database notebook</a>
              <br />
              <small>${fsPath}</small>
            </p>`);
    reportText = reportText.replace(/<!-- __FOOTER_CONTENTS__ -->/, htmlContents.join("\n"));

    //__CUSTOM_SCRIPT__
    htmlContents = [];
    htmlContents.push(`<script>
  var markdownValues = ${JSON.stringify(markdownValues)};
  var chartValues = ${JSON.stringify(chartValues)};
  var numOfContents = ${cells.length};
  </script>`);
    reportText = reportText.replace(/<!-- __CUSTOM_SCRIPT__ -->/, htmlContents.join("\n"));

    await writeToResourceOnStorage(fsPath, reportText);
  } catch (e) {
    console.error(e);
    logError(`${PREFIX} ${e}`);
    if (e instanceof Error) {
      errorMessage = e.message;
    } else {
      errorMessage = e + "";
    }
  }

  return errorMessage;
};

const MARKDOWN_TOC_PREVIEW_MAX_LENGTH = 30;

// Prefer the first heading line as a title-like preview; fall back to the
// first non-empty line for markdown cells that don't lead with a heading.
const getMarkdownTocPreview = (text: string): string => {
  const lines = text.split(/\r\n|\r|\n/);
  const headingLine = lines.find((line) => /^\s{0,3}#{1,6}\s+\S/.test(line));
  const line = headingLine
    ? headingLine.replace(/^\s{0,3}#{1,6}\s+/, "").trim()
    : (lines.find((line) => line.trim().length > 0) ?? "").trim();
  if (line.length > MARKDOWN_TOC_PREVIEW_MAX_LENGTH) {
    return line.substring(0, MARKDOWN_TOC_PREVIEW_MAX_LENGTH) + "...";
  }
  return line;
};

const getTocInfoHtml = (cell: NotebookCell): string => {
  if (isMarkupCell(cell)) {
    const preview = getMarkdownTocPreview(cell.document.getText());
    return (
      '<span class="tag is-info is-light">Markdown</span>' +
      (preview ? ` ${escapeHtml(preview)}` : "")
    );
  }
  let s = "";

  // A user-set cellLabel identifies the cell's content (for example, "Full
  // context JSON"). Keep it as the final plain-text description, following
  // the language and execution-status tags used by the other cell types.
  const { cellLabel } = cell.metadata as CellMeta;
  const labelText = cellLabel ? ` ${escapeHtml(cellLabel)}` : "";
  if (cellLabel) {
    const language = cell.document.languageId || "Code";
    s = `<span class="tag is-info is-light">${escapeHtml(language)}</span>`;
  } else if (cell.document.languageId) {
    s = `<span class="tag is-info is-light">${cell.document.languageId}</span>`;
  }

  if (cell.outputs.length === 0) {
    s += '<span class="tag is-info is-light">Not executed</span>';
    return s + labelText;
  }
  // SKIPPED CELL ------
  if (
    cell.outputs.some(
      (it) =>
        (it.metadata as RunResultMetadata)?.status === "skipped" &&
        (it.metadata as RunResultMetadata)?.lmResult === undefined
    )
  ) {
    s += '<span class="tag is-warning is-light">Skipped</span>';
    return s + labelText;
  }

  // LM RESULET CELL -------
  if (cell.outputs.some((it) => (it.metadata as RunResultMetadata)?.lmResult !== undefined)) {
    s += '<span class="tag is-warning is-light">Evaluated</span>';
    return s + labelText;
  }

  let hasError = cell.outputs.some((it) => (it.metadata as RunResultMetadata)?.status === "error");
  if (hasError) {
    s += '<span class="tag is-danger is-light">Error</span>';
  } else {
    s += '<span class="tag is-primary is-light">Exequted</span>';
  }

  cell.outputs.forEach((output, idx3) => {
    if (output.metadata) {
      const metadata: RunResultMetadata = output.metadata;
      const { rdh, axiosEvent, mqttPublishResult } = metadata;
      if (rdh) {
        if (rdh.meta.type) {
          s += `<span class="tag is-info is-light">${escapeHtml(rdh.meta.type)}</span>`;
        }
        if (rdh.meta.tableName) {
          s += `<span class="tag is-info is-light">${escapeHtml(rdh.meta.tableName)}</span>`;
        }
        if (rdh.meta.logGroupName) {
          s += `<span class="tag is-info is-light">${escapeHtml(rdh.meta.logGroupName)}</span>`;
        }
        if (rdh.meta.logStreamName) {
          s += `<span class="tag is-info is-light">${escapeHtml(rdh.meta.logStreamName)}</span>`;
        }
      }
      if (axiosEvent) {
        const { response, request } = axiosEvent.entry;
        s += createAxiosTocInfoHtml(response, request.method, request.url, axiosEvent.entry.time);
      }
      if (mqttPublishResult) {
        const { subscription } = mqttPublishResult;
        s += `<span class="tag is-info is-light">${subscription}</span>`;
      }
      if (metadata.shellResult) {
        s += `<span class="tag is-light is-warning">Time:${prettyTime(
          metadata.shellResult.elapsedTime
        )}</span>`;
      }
    }
    if (hasError) {
      const item = output.items.find((it) =>
        ["application/vnd.code.notebook.stderr", "application/vnd.code.notebook.error"].includes(
          it.mime
        )
      );
      if (item) {
        s += escapeHtml(abbr(item.data.toString(), 64)!);
      }
    } else {
      if (output.metadata?.rdh) {
        const title = output.metadata?.rdh.meta.command ? "Command Result" : "Query Result";
        s += `<span class="tag is-primary is-light">${title}</span> ${escapeHtml(
          output.metadata.rdh.summary?.info ?? ""
        )}`;
      }
      if (output.metadata?.mqttPublishResult) {
        const { payloadLength, elapsedTime } = output.metadata.mqttPublishResult;
        const result = `[Elapsed Time]:${prettyTime(
          elapsedTime
        )} [Payload Length]:${payloadLength}`;
        s += `<span class="tag is-primary is-light">Result</span> ${escapeHtml(result)}`;
      }
    }
  });

  return s + labelText;
};

const createDiffTitle = (item: DiffTabInnerItem) => {
  const { rdh1, title, diffResult } = item;
  const comment = rdh1.meta.comment ? ":" + rdh1.meta.comment : "";
  const inserted = `<span class="tag is-primary is-light">Inserted:${diffResult.inserted}</span>`;
  const deleted = `<span class="tag is-danger is-light">Deleted:${diffResult.deleted}</span>`;
  const updated = `<span class="tag is-info is-light">Updated:${diffResult.updated}</span>`;
  return `${escapeHtml(title)}${escapeHtml(comment)} ${inserted} ${deleted} ${updated}`;
};
