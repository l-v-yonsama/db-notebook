import { NotebookCell, NotebookCellKind, NotebookDocument } from "vscode";
import { writeToResourceOnStorage } from "./fsUtil";
import { CellMeta } from "../types/Notebook";
import { RunResultMetadata } from "../shared/RunResultMetadata";
import {
  abbr,
  escapeHtml,
  prettyFileSize,
  prettyTime,
  ResultSetDataBuilder,
  ToStringParam,
} from "@l-v-yonsama/multi-platform-database-drivers";
import dayjs = require("dayjs");
import { ExtChartData, ExtChartOptions, PairPlotChartParams } from "../shared/ExtChartJs";
import { createChartJsParams, createPairPlotChartParams } from "./chartUtil";
import { ChartsViewParams } from "../types/views";
import { createResponseBodyMarkdown, getHeaderValue } from "./httpUtil";
import { getOutputConfig, getResultsetConfig, getToStringParamByConfig } from "./configUtil";

const HTML_CONTENT_PREFIX = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title></title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.1/css/bulma.min.css">
    <script src="https://code.jquery.com/jquery-1.9.1.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.5.1/build/styles/github.min.css">
    <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.5.1/build/highlight.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked@4.0.16/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0"></script>
    <style>
      nav a span.tag {
        margin-left: 5px;
        margin-right: 5px;
        min-width: 90px;
        text-align: center;
      }

      div.chart {
        color: gray;
        background-color: white;
      }

      .pair-plot-chart {
        overflow-y: auto;
      }
      .pair-plot-chart p.title {
        text-align: center;
        margin: 2px 0;
      }
      .pair-plot-chart .legends {
        text-align: center;
        margin-bottom: 1px;
      }
      .pair-plot-chart .legends div.legend {
        display: inline-block;
        min-width: 3em;
        padding: 0px 5px;
        margin-right: 2em;
        border-width: 2px;
        border-style: solid;
        line-height: 1.2;
      }

      .pair-plot-chart table {
        table-layout: fixed;
        width: 100%;
      }

      .pair-plot-chart th {
        font-weight: normal;
        background-color: #e0e0e0;
        text-align: center;
        color: gray;
      }
      .pair-plot-chart th.rl {
        width: 1.2em;
        text-align: center;
      }
      .pair-plot-chart th div.rl {
        line-height: 0.9em;
        width: 1.2em;
        text-align: center;
        white-space: pre-line;
        overflow: hidden;
        writing-mode: vertical-rl;
      }
      .pair-plot-chart td {
        vertical-align: middle;
        border: 1px dotted silver;
        text-align: center;
      }
      .pair-plot-chart td .very_weak {
        color: #999;
        font-size: small;
      }
      .pair-plot-chart td .weak {
        color: #666;
      }
      .pair-plot-chart td .moderate {
        color: #333;
        font-size: large;
      }
      .pair-plot-chart td .strong {
        color: #000;
        font-size: x-large;
      }
      .pair-plot-chart td .very_strong {
        color: #400;
        font-size: xx-large;
      }
      .pair-plot-chart .correlation {
        text-align: center;
      }

      .pagetop {
        height: 50px;
        width: 50px;
        position: fixed;
        right: 30px;
        bottom: 30px;
        background: #fff;
        border: solid 2px #000;
        border-radius: 50%;
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 2;
        cursor: pointer;
      }
      .pagetop__arrow {
        display: block;
        height: 10px;
        width: 10px;
        border-top: 3px solid #000;
        border-right: 3px solid #000;
        transform: translateY(20%) rotate(-45deg);
      }

      </style>
</head>
<body>
 <section class="section">
  <div class="container">
  <h2 class="subtitle is-2">Database Notebook Report.</h2>
`;

export const createHtml = async (notebook: NotebookDocument, fsPath: string): Promise<string> => {
  let htmlContents: string[] = [];
  let errorMessage = "";
  const markdownValues: { [key: string]: string } = {};
  const chartValues: { [key: string]: string } = {};
  const pairPlotChartValues: { [key: string]: string } = {};
  const cells = notebook.getCells();
  const outputCondig = getOutputConfig();

  const toHtmlParams = getToStringParamByConfig();

  htmlContents.push(HTML_CONTENT_PREFIX);

  htmlContents.push(`<nav class="panel">`);

  // TOC
  if (outputCondig.html.displayToc) {
    htmlContents.push(`  <p class="panel-heading" style="padding:10px">TOC</p>`);
    cells.forEach((cell, idx) => {
      htmlContents.push(
        `  <a class="panel-block" href="#cell${idx + 1}" style="padding:10px; font-size:small;">`
      );
      htmlContents.push(`    CELL${idx + 1} ${getTocInfoHtml(cell)}`);

      htmlContents.push(`  </a>`);
    });
    htmlContents.push(`</nav>`);
  }

  // CONTENTS
  cells.forEach((cell, idx) => {
    const cellMeta: CellMeta = cell.metadata;
    htmlContents.push("<hr>");
    const id = `id${idx}`;

    htmlContents.push(`<h4 class="title is-4" ><a name="cell${idx + 1}">CELL${idx + 1}</a></h4>`);
    if (cell.kind === NotebookCellKind.Markup) {
      htmlContents.push(`<div id="${id}" class="block">`);
      htmlContents.push("</div>");
      markdownValues[id] = cell.document.getText();
    } else {
      htmlContents.push(`<div id="${id}" class="block">`);
      htmlContents.push("</div>");
      markdownValues[id] = `\`\`\`${cell.document.languageId}\n${cell.document.getText()}\n\`\`\``;

      if (cell.outputs.some((it) => (it.metadata as RunResultMetadata).status === "skipped")) {
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
                    htmlContents.push(
                      `<div class="notification is-info is-light" style="padding:10px; margin-bottom:10px;font-size:small; white-space:pre-wrap;">${escapeHtml(
                        item.data.toString()
                      )}</div>`
                    );
                  }
                }
                break;
              case "application/vnd.code.notebook.stderr":
              case "application/vnd.code.notebook.error":
                {
                  htmlContents.push(
                    `<div class="notification is-danger is-light" style="padding:10px; margin-bottom:10px; font-size:small; white-space:pre-wrap;">${escapeHtml(
                      item.data.toString()
                    )}</div>`
                  );
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
                        `      ${escapeHtml(hueLegend.pointSymbol)}: ${escapeHtml(hueLegend.title)}`
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
                        chartValues[pairPlotChartId] = JSON.stringify({
                          type: matrix.type === "histogram" ? "bar" : "scatter",
                          data: matrix.chartParams?.data,
                          options: matrix.chartParams?.options,
                        });
                      } else {
                        htmlContents.push(
                          `          <div   class="correlation ${getSampleCorrelationClass(
                            matrix.correlation!
                          )}" >`
                        );
                        htmlContents.push(
                          `            R = ${(matrix.correlation ?? 0).toFixed(2)}`
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
                  chartValues[chartId] = JSON.stringify({
                    type: params.type,
                    data,
                    options,
                    pairPlotChartParams,
                  });
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
              markdownValues[mdId] = createResponseBodyMarkdown(metadata.axiosEvent);
            }
          }
        });
      }
    }
  });
  htmlContents.push(
    `<button id="js-pagetop" class="pagetop"><span class="pagetop__arrow"></span></button>`
  );
  htmlContents.push(`
  <footer class="footer has-text-centered" style="padding: 1rem;">
    <article class="media">
      <figure class="media-left">
        <p class="image is-64x64">
           <img src='https://l-v-yonsama.github.io/db-notebook/media/logo128.png'>
        </p>
      </figure>
      <div class="media-content">
        <div class="content">
          <p>
            This report was generated at ${dayjs().format(
              "YYYY-MM-DD HH:mm"
            )} in <a href="https://marketplace.visualstudio.com/items?itemName=HirotakaYoshioka.database-notebook">Database notebook</a>
            <br />
            <small>${fsPath}</small>
          </p>
        </div>
      </div>
    </article>
  </div>
  </footer>
  `);
  htmlContents.push(`  </div>
</section>
`);
  htmlContents.push(`<script>
var markdownValues = ${JSON.stringify(markdownValues)}
var chartValues = ${JSON.stringify(chartValues)}
var pairPlotChartValues = ${JSON.stringify(pairPlotChartValues)}
</script>`);
  htmlContents.push("<script>");
  htmlContents.push("  $(function() {");
  htmlContents.push("    const $pageTop = $('#js-pagetop');");
  htmlContents.push("    $(window).scroll(function () {");
  htmlContents.push("      if ($(window).scrollTop() > 100) {");
  htmlContents.push("        $pageTop.fadeIn(300).css('display', 'flex');");
  htmlContents.push("      } else {");
  htmlContents.push("        $pageTop.fadeOut(300);");
  htmlContents.push("      }");
  htmlContents.push("    });");
  htmlContents.push("    $pageTop.click(function () {");
  htmlContents.push("      $('html, body').animate({ scrollTop: 0 }, 300);");
  htmlContents.push("    });");

  htmlContents.push("    var renderer = new marked.Renderer();");
  htmlContents.push("    renderer.code = (code, language) => {");
  htmlContents.push(
    "      return '<pre><code>' + hljs.highlightAuto(code).value + '</code></pre>';   "
  );
  htmlContents.push("    };");
  htmlContents.push("    renderer.heading = (tokens, depth) => {");
  htmlContents.push(
    "      return `<h${depth} class='subtitle is-${depth}'>${tokens}</h${depth}>`;"
  );
  htmlContents.push("    };");
  htmlContents.push("    renderer.table = (header, body) => {");
  htmlContents.push(
    `      return '<table class="table is-bordered is-striped is-narrow is-hoverable is-fullwidth">\\n'`
  );
  htmlContents.push("        + '<thead>\\n'");
  htmlContents.push("        + header");
  htmlContents.push("        + '</thead>\\n'");
  htmlContents.push("        + body");
  htmlContents.push("        + '</table>\\n';");
  htmlContents.push("    };");
  htmlContents.push("    marked.use({ renderer });");
  htmlContents.push("");
  htmlContents.push("    Object.keys(markdownValues).forEach(it=>{");
  htmlContents.push("      const content = markdownValues[it];");
  htmlContents.push("      const md = marked.parse(content);");
  htmlContents.push("      $('#' + it).html(md);");
  htmlContents.push("    });");
  htmlContents.push("    // chart");
  htmlContents.push("    Object.keys(chartValues).forEach(chartId=>{");
  htmlContents.push("      try {");
  htmlContents.push("        const content = JSON.parse(chartValues[chartId]);");
  htmlContents.push("        const ctx = document.getElementById(chartId).getContext('2d');");
  htmlContents.push("        new Chart(ctx, {");
  htmlContents.push("           type: content.type,");
  htmlContents.push("           data: content.data,");
  htmlContents.push("           options: content.options,");
  htmlContents.push("           plugins: [ ChartDataLabels ]");
  htmlContents.push("        });");
  htmlContents.push("      } catch (e){");
  htmlContents.push("        console.error('ERROR chartId[' + chartId + ']', e);");
  htmlContents.push("      }");
  htmlContents.push("    });");
  htmlContents.push("  });");
  htmlContents.push("</script>");
  htmlContents.push(`
</body>
</html>
`);

  await writeToResourceOnStorage(fsPath, htmlContents.join("\n"));
  return errorMessage;
};

const getTocInfoHtml = (cell: NotebookCell): string => {
  if (cell.kind === NotebookCellKind.Markup) {
    return "";
  }
  if (cell.outputs.length === 0) {
    return '<span class="tag is-info is-light">Not executed</span>';
  }
  if (cell.outputs.some((it) => (it.metadata as RunResultMetadata).status === "skipped")) {
    return '<span class="tag is-warning is-light">Skipped</span>';
  }

  let hasError = cell.outputs.some((it) => (it.metadata as RunResultMetadata).status === "error");
  let s = "";
  if (hasError) {
    s = '<span class="tag is-danger is-light">Error</span>';
  } else {
    s = '<span class="tag is-primary is-light">Exequted</span>';
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
        const { response } = axiosEvent.entry;
        const statusPrefix = Math.floor(response.status / 100);
        let title = `<span class="tag ${
          statusPrefix <= 3 ? "is-success" : "is-danger"
        } is-light">STATUS:${response.status} ${response.statusText}`;
        if (statusPrefix <= 3) {
          title += "😀";
        } else {
          title += "😱";
        }
        title += "</span>";

        if (response.content.mimeType) {
          title += ` <span class="tag is-light is-warning">Content-Type:${response.content.mimeType}</span>`;
        }

        if (axiosEvent.entry.time !== undefined) {
          title += ` <span class="tag is-light is-warning">Elapsed Time:${prettyTime(
            axiosEvent.entry.time
          )}</span>`;
        }
        s += title;
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

const getSampleCorrelationClass = (correlation: number): string[] => {
  const absV = Math.abs(correlation ? correlation : 0);
  if (absV <= 0.2) {
    return ["very_weak"];
  } else if (absV <= 0.4) {
    return ["weak"];
  } else if (absV <= 0.6) {
    return ["moderate"];
  } else if (absV <= 0.6) {
    return ["strong"];
  } else {
    return ["very_strong"];
  }
};
