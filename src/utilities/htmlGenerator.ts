import { parseContentType, prettyTime } from "@l-v-yonsama/multi-platform-database-drivers";
import {
  abbr,
  ContentTypeInfo,
  escapeHtml,
  GeneralColumnType,
  ResultSetData,
  ResultSetDataBuilder,
} from "@l-v-yonsama/rdh";
import { promises as fs } from "fs";
import { Cookie, Header, Response } from "har-format";
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
import { DiffTabInnerItem, HarFileTabItem } from "../shared/MessageEventData";
import { RunResultMetadata } from "../shared/RunResultMetadata";
import { CellMeta } from "../types/Notebook";
import { ChartsViewParams } from "../types/views";
import { createChartJsParams, createPairPlotChartParams } from "./chartUtil";
import { getOutputConfig, getToStringParamByConfig } from "./configUtil";
import { writeToResourceOnStorage } from "./fsUtil";
import { createResponseBodyMarkdown } from "./httpUtil";
import { logError } from "./logger";
import dayjs = require("dayjs");
import path = require("path");
const PREFIX = "[utilities/htmlGenerator]";

type CreateHtmlOptionsParams = {
  isCellOrigin: boolean;
};

type MarkdownValues = { [key: string]: { lang: string; s: string } };

export const createHtmlFromHarItem = async (
  { title, res, rdh }: Omit<HarFileTabItem, "tabId">,
  fsPath: string
): Promise<string> => {
  let htmlContents: string[] = [];
  let errorMessage = "";
  const markdownValues: MarkdownValues = {};
  const outputCondig = getOutputConfig();

  const headersToRdb = (headers: Header[]): ResultSetDataBuilder => {
    const rdb = new ResultSetDataBuilder(["name", "value"]);
    headers.forEach((header) => {
      rdb.addRow({ name: header.name, value: header.value });
    });
    return rdb;
  };

  const cookiesToRdb = (cookies: Cookie[]): ResultSetDataBuilder => {
    const rdb = new ResultSetDataBuilder([
      "name",
      "value",
      "domain",
      "path",
      "expires",
      "httpOnly",
      "secure",
    ]);
    rdb.updateKeyType("httpOnly", GeneralColumnType.BOOLEAN);
    rdb.updateKeyType("secure", GeneralColumnType.BOOLEAN);
    cookies.forEach(({ name, value, domain, path, expires, httpOnly, secure }) => {
      rdb.addRow({ name, value, domain, path, expires, httpOnly, secure });
    });
    return rdb;
  };

  try {
    const reportFilePath = path.join(mediaDir, "template", "har.html");
    let reportText = await fs.readFile(reportFilePath, { encoding: "utf8" });

    htmlContents = [];
    htmlContents.push(`<nav class="panel toc">`);
    // TOC
    if (outputCondig.html.displayToc) {
      htmlContents.push(`  <p class="panel-heading" style="padding:10px">TOC</p>`);

      res.log.entries.forEach((entry, idx) => {
        const { response, request } = entry;

        htmlContents.push(
          `  <a class="panel-block cellIdx${idx}" href="#cell${idx + 1}" data-status="${
            response.status
          }" data-content="${response.content.mimeType}" style="padding:10px; font-size:small;">`
        );
        htmlContents.push(
          `    No${idx + 1} ${createAxiosTocInfoHtml(
            response,
            request.method,
            request.url,
            entry.time
          )}`
        );
        htmlContents.push(`  </a>`);
      });
      htmlContents.push(`</nav>`);
    }
    reportText = reportText.replace(/<!-- __TOC__ -->/, htmlContents.join("\n"));

    // CONTENTS
    htmlContents = [];
    for (let idx = 0; idx < res.log.entries.length; idx++) {
      const entry = res.log.entries[idx];
      const { response, request } = entry;

      htmlContents.push(`<hr class="cellIdx${idx}" />`);
      const id = `id${idx}`;

      htmlContents.push(`<div class="wrapper cellIdx${idx}" >`);

      htmlContents.push(
        `<h5 class="title is-5 ellipsis" style="position:relative;"><a name="cell${idx + 1}">No${
          idx + 1
        }</a> ${createAxiosTocInfoHtml(
          response,
          request.method,
          request.url,
          entry.time
        )} ${createClipButton(request.url)}</h5>`
      );

      // request
      {
        htmlContents.push(`<h6 class="subtitle is-6" >■ Request</h6>`);
        const idClass = `${id}-req`;

        htmlContents.push(`<div id="${idClass}" class="block request">`);

        const tabClass = idClass + "-tab";
        const tabsBuilder = new TabsBuilder(tabClass);
        let tabContents: string[] = [];

        // headers
        tabsBuilder.addTab({ title: "Headers", kind: "headers", faIcon: "heading", active: true });
        tabContents.push(
          createGeneralTableBlock("headers", tabClass, headersToRdb(request.headers), true)
        );

        if (request.queryString.length > 0) {
          tabsBuilder.addTab({
            title: "QueryString",
            kind: "queryString",
            faIcon: "list",
            active: false,
          });
          const rdb = new ResultSetDataBuilder(["name", "value"]);
          request.queryString.forEach((qs) => {
            rdb.addRow({ name: qs.name, value: qs.value });
          });
          tabContents.push(createGeneralTableBlock("queryString", tabClass, rdb, false));
        }
        if (request.postData) {
          tabsBuilder.addTab({
            title: "PostData",
            kind: "postData",
            faIcon: "layer-group",
            active: false,
          });
          const { mimeType, params, text } = request.postData;
          const contentTypeInfo = parseContentType({
            contentType: mimeType,
          });
          if (params?.length) {
            const rdb = new ResultSetDataBuilder(["name", "value", "fileName", "contentType"]);
            params.forEach(({ name, value, fileName, contentType }) => {
              rdb.addRow({ name, value, fileName, contentType });
            });
            tabContents.push(createGeneralTableBlock("postData", tabClass, rdb, false));
          } else if (text) {
            tabContents.push(
              `<div id="${tabClass}-data" class="block ${tabClass}" style="display:none;">`
            );
            tabContents.push("<pre><code>");
            // htmlContents.push(await contentToHtmlString(contentTypeInfo, request.postData.));
            tabContents.push("</code></pre>");
            tabContents.push("</div>");
          }
        }
        if (request.cookies && request.cookies.length > 0) {
          tabsBuilder.addTab({
            title: "Cookies",
            kind: "cookies",
            faIcon: "cookie-bite",
            active: false,
          });
          tabContents.push(
            createGeneralTableBlock("cookies", tabClass, cookiesToRdb(request.cookies), false)
          );
        }
        htmlContents.push(tabsBuilder.build());
        htmlContents.push(...tabContents); // end tabs

        htmlContents.push("</div>"); // end id block
      }

      // response
      {
        htmlContents.push(`<h6 class="subtitle is-6" >■ Response</h6>`);

        const idClass = `${id}-res`;
        const contentTypeInfo = parseContentType({
          contentType: response.content.mimeType,
          fileName: request?.url,
        });
        htmlContents.push(`<div id="${idClass}" class="block response">`);

        const tabClass = idClass + "-tab";
        const tabsBuilder = new TabsBuilder(tabClass);
        let tabContents: string[] = [];

        // headers
        tabsBuilder.addTab({ title: "Headers", kind: "headers", faIcon: "heading", active: true });
        tabContents.push(
          createGeneralTableBlock("headers", tabClass, headersToRdb(response.headers), true)
        );

        // data
        tabsBuilder.addTab({ title: "Data", kind: "data", faIcon: "layer-group", active: false });
        tabContents.push(
          createDataBlock({
            id: `${tabClass}-data`,
            contentTypeInfo,
            text: response.content.text ?? "",
            markdownValues,
            clazz: tabClass,
            active: false,
          })
        );

        // preview
        if (contentTypeInfo.renderType === "Image") {
          tabsBuilder.addTab({ title: "Preview", kind: "preview", faIcon: "image", active: false });
          tabContents.push(
            `<div id="${tabClass}-preview" class="block ${tabClass}" style="display:none;">`
          );
          const imgSrc =
            contentTypeInfo.contentType === "image/svg+xml"
              ? `data:image/svg+xml,${encodeURIComponent(response.content.text + "")}`
              : `data:${contentTypeInfo.contentType};base64,${response.content.text + ""}`;
          tabContents.push(`<img src="${imgSrc}" >`);
          tabContents.push("</div>");
        }

        // cookies
        if (response.cookies && response.cookies.length > 0) {
          tabsBuilder.addTab({
            title: "Cookies",
            kind: "cookies",
            faIcon: "cookie-bite",
            active: false,
          });
          tabContents.push(
            createGeneralTableBlock("cookies", tabClass, cookiesToRdb(response.cookies), false)
          );
        }
        htmlContents.push(tabsBuilder.build());
        htmlContents.push(...tabContents);
        // end tabs

        htmlContents.push("</div>"); // end id block
      }

      htmlContents.push(`</div>`);
    }

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
      <!--
  var markdownValues = ${JSON.stringify(markdownValues)};
  var responseCoreValues = ${JSON.stringify(
    res.log.entries.map((it) => ({
      url: it.request.url,
      method: it.request.method,
      status: it.response.status,
      contentType: it.response.content.mimeType,
    }))
  )};
  var numOfContents = ${res.log.entries.length};
   // -->
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
    outputs.push(
      new NotebookCellOutput(
        [
          NotebookCellOutputItem.text(
            `\`[Query Result]\` ${rdh.summary?.info}\n` +
              ResultSetDataBuilder.from(rdh).toMarkdown(toMarkdownConfig),
            "text/markdown"
          ),
        ],
        runResultMetadata
      )
    );

    const cell = {
      index,
      kind: NotebookCellKind.Code,
      notebook: null as unknown as NotebookDocument,
      document: {
        languageId: "sql",
        getText: () => rdh.sqlStatement ?? "",
      } as TextDocument,
      metadata: {} as CellMeta,
      outputs,
      executionSummary: undefined,
    };

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
      htmlContents.push(`<hr class="cellIdx${idx}" />`);
      const id = `id${idx}`;

      htmlContents.push(`<div class="wrapper cellIdx${idx} compact" >`);

      htmlContents.push(
        `<h4 class="title is-4" ><a name="cell${idx + 1}">${isCellOrigin ? "CELL" : "No"}${
          idx + 1
        }</a></h4>`
      );
      if (cell.kind === NotebookCellKind.Markup) {
        htmlContents.push(`<div id="${id}" class="block">`);
        htmlContents.push("</div>");
        markdownValues[id] = { lang: "Markup", s: escapeHtml(cell.document.getText()) };
      } else {
        htmlContents.push(`<div id="${id}" class="block">`);
        htmlContents.push("</div>");
        markdownValues[id] = {
          lang: cell.document.languageId,
          s: escapeHtml(cell.document.getText()),
        };

        if (cell.outputs.some((it) => (it.metadata as RunResultMetadata)?.status === "skipped")) {
          htmlContents.push(
            `<div class="notification is-warning is-light" style="padding:10px; margin-bottom:10px;font-size:small;">Skipped</div>`
          );
        } else {
          cell.outputs.forEach((output) => {
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
                htmlContents.push(
                  `<div class="notification is-primary is-light" style="padding:10px; margin-bottom:10px;font-size:small;">`
                );
                htmlContents.push(
                  `<span class="tag is-primary is-light">Query Result</span> ${escapeHtml(
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

const getTocInfoHtml = (cell: NotebookCell): string => {
  if (cell.kind === NotebookCellKind.Markup) {
    return '<span class="tag is-info is-light">Markdown</span>';
  }
  let s = `<span class="tag is-info is-light">${cell.document.languageId}</span>`;

  if (cell.outputs.length === 0) {
    s += '<span class="tag is-info is-light">Not executed</span>';
    return s;
  }
  if (cell.outputs.some((it) => (it.metadata as RunResultMetadata)?.status === "skipped")) {
    s += '<span class="tag is-warning is-light">Skipped</span>';
    return s;
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
      const { rdh, axiosEvent } = metadata;
      if (rdh) {
        if (rdh.meta.type) {
          s += `<span class="tag is-info is-light">${escapeHtml(rdh.meta.type)}</span>`;
        }
        if (rdh.meta.tableName) {
          s += `<span class="tag is-info is-light">${escapeHtml(rdh.meta.tableName)}</span>`;
        }
      }
      if (axiosEvent) {
        const { response, request } = axiosEvent.entry;
        s += createAxiosTocInfoHtml(response, request.method, request.url, axiosEvent.entry.time);
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
        s += `<span class="tag is-primary is-light">Query Result</span> ${escapeHtml(
          output.metadata.rdh.summary?.info ?? ""
        )}`;
      }
    }
  });

  return s;
};

const createGeneralTableBlock = (
  kind: string,
  clazz: string,
  rdb: ResultSetDataBuilder,
  visible: boolean
): string => {
  const htmlContents = [];
  const toHtmlParams = getToStringParamByConfig();
  htmlContents.push(
    `<div id="${clazz}-${kind}" class="block ${clazz} compact" style="${
      visible ? "" : "display:none"
    }">`
  );
  htmlContents.push(rdb.toHtml({ ...toHtmlParams, withRowNo: false, withType: false }));
  htmlContents.push("</div>");
  return htmlContents.join("\n");
};

const createAxiosTocInfoHtml = (
  response: Response,
  method: string,
  url: string,
  entryTime?: number
): string => {
  const statusPrefix = Math.floor(response.status / 100);
  let title = `<span class="tag ${statusPrefix <= 3 ? "is-success" : "is-danger"} is-light">${
    response.status
  } ${response.statusText}`;
  if (statusPrefix <= 3) {
    title += "😀";
  } else {
    title += "😱";
  }
  title += "</span>";

  if (method) {
    title += ` <span class="tag is-light is-info">${method}</span>`;
  }
  if (response.content.mimeType) {
    title += ` <span class="tag is-light is-link">${response.content.mimeType}</span>`;
  }

  if (entryTime !== undefined) {
    title += ` <span class="tag is-light is-warning">Time:${prettyTime(entryTime)}</span>`;
  }
  return title + `<span class="url">${url}</span>`;
};

const createDiffTitle = (item: DiffTabInnerItem) => {
  const { rdh1, title, diffResult } = item;
  const comment = rdh1.meta.comment ? ":" + rdh1.meta.comment : "";
  const inserted = `<span class="tag is-primary is-light">Inserted:${diffResult.inserted}</span>`;
  const deleted = `<span class="tag is-danger is-light">Deleted:${diffResult.deleted}</span>`;
  const updated = `<span class="tag is-info is-light">Updated:${diffResult.updated}</span>`;
  return `${escapeHtml(title)}${escapeHtml(comment)} ${inserted} ${deleted} ${updated}`;
};

const createClipButton = (clipData: string): string => {
  return `<button class="clipboard button is-small" data-clip="${escapeHtml(
    clipData
  )}"><span class="icon is-small"><i class="fas fa-clipboard"></i></span></button>`;
};

class TabsBuilder {
  private items: string[] = [];
  constructor(private readonly id: string) {}

  addTab({
    title,
    kind,
    faIcon,
    active,
  }: {
    title: string;
    kind: string;
    faIcon: string;
    active: boolean;
  }): void {
    const itemId = `${this.id}-${kind}-item`;
    const activeClass = active ? "is-active" : "";
    let s = `<li class="${activeClass}">`;
    s += `<a id="${itemId}" data-tab="${kind}" data-id-class="${this.id}">`;
    s += `<span class="icon is-small"><i class="fas fa-${faIcon}"></i></span>`;
    s += `<span>${title}</span>`;
    s += `</a></li>`;
    this.items.push(s);
  }

  build(): string {
    let s = `<div id="${this.id}" class="tabs is-boxed is-small">`;
    s += "<ul>";
    s += this.items.join("\n");
    s += "</ul>";
    s += "</div>";
    return s;
  }
}

const createDataBlock = (params: {
  id: string;
  contentTypeInfo: ContentTypeInfo;
  text: string;
  markdownValues: MarkdownValues;
  clazz?: string;
  active?: boolean;
}): string => {
  const { id, contentTypeInfo, text, markdownValues, clazz, active } = {
    clazz: "",
    active: true,
    ...params,
  };

  let contents: string[] = [];
  let s = text;
  if (contentTypeInfo.isTextValue && text) {
    if (contentTypeInfo.shortLang === "json") {
      try {
        s = JSON.stringify(JSON.parse(text), null, 2);
      } catch (_) {}
    }
  }
  const activeClass = active ? "block" : "none";
  contents.push(`<div id="${id}" class="block ${clazz}" style="display:${activeClass};">`);
  markdownValues[id] = { lang: contentTypeInfo.shortLang ?? "text", s: escapeHtml(s) };
  contents.push("</div>");

  return contents.join("\n");
};
