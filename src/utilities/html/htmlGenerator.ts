import { getRpcCallKind, prettyTime } from "@l-v-yonsama/multi-platform-database-drivers";
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
import { mediaDir } from "../../constant";
import { ExtChartData, ExtChartOptions, PairPlotChartParams } from "../../shared/ExtChartJs";
import { DiffTabInnerItem } from "../../shared/MessageEventData";
import { RunResultMetadata } from "../../shared/RunResultMetadata";
import type { RpcNotebookResult } from "../../shared/RunResultMetadata";
import type { RpcInvokeTarget } from "../../shared/RpcInvokePanelParams";
import { decodeRpcCellSource, isRpcCellMetadata, RPC_RESPONSE_MIME } from "../../notebook/rpcCell";
import type { RestCellMeta } from "../../notebook/restCell";
import { CellMeta } from "../../types/Notebook";
import { ChartsViewParams } from "../../types/views";
import { createReportChartViewParams } from "../../observability/report/reportChartAdapter";
import { isReportChartSpec } from "../../notebook/report/reportTypes";
import { createChartJsParams, createPairPlotChartParams } from "../chart/chartUtil";
import { getOutputConfig, getToStringParamByConfig } from "../configUtil";
import { writeToResourceOnStorage } from "../fsUtil";
// Keep the HTML-generation entry points together while the HAR-specific
// implementation remains isolated in harHtmlGenerator.ts.
export { createHtmlFromHarItem } from "./harHtmlGenerator";
export type { MarkdownValues } from "./common";
import { createAxiosTocInfoHtml, MarkdownValues } from "./common";
import { createResponseBodyMarkdown } from "../httpUtil";
import { logError } from "../logger";
import { isMemcachedCell, isRedisCell } from "../notebookUtil";
import { formatRpcStatus, formatRpcTransferSummary } from "../rpcResultSummary";
const PREFIX = "[utilities/html/htmlGenerator]";

type CreateHtmlOptionsParams = {
  isCellOrigin: boolean;
  rpcDescriptions?: ReadonlyMap<ReportCell, RpcReportDescriptions>;
};

type RpcReportDescriptions = { request: string; response: string };

// highlight.js doesn't recognize some of our VS Code-specific cell languageIds
// -- map them to the closest hljs-supported language so the HTML export gets
// real syntax highlighting instead of silently falling back to (often wrong)
// auto-detection. "redis" needs no entry here: the report template registers
// a dedicated hljs "redis" language (see report.html) since bash's keywords
// are lowercase-only and don't match redis-cli's uppercase convention.
const HLJS_LANGUAGE_ALIASES: { [languageId: string]: string } = {
  "shellscript": "bash",
  "bat": "dos",
  "rpc-json": "json",
  "rest-json": "json",
};

const toHljsLanguage = (languageId: string): string =>
  HLJS_LANGUAGE_ALIASES[languageId] ?? languageId;

export const createHtmlFromNotebook = async (
  notebook: NotebookDocument,
  fsPath: string,
  getRpcDescriptions?: (cell: NotebookCell) => Promise<RpcReportDescriptions>
): Promise<string> => {
  const cells = notebook.getCells();
  const rpcDescriptions = new Map<ReportCell, RpcReportDescriptions>();
  if (getRpcDescriptions) {
    for (const cell of cells) {
      if (cell.document.languageId !== "rpc-json") {
        continue;
      }
      try {
        rpcDescriptions.set(cell, await getRpcDescriptions(cell));
      } catch {
        // A report remains exportable when its live descriptor cannot be loaded.
      }
    }
  }
  return createHtml(cells, fsPath, { isCellOrigin: true, rpcDescriptions });
};

type ReportCell = Pick<NotebookCell, "kind" | "metadata" | "outputs"> & {
  document: Pick<TextDocument, "languageId" | "getText">;
};

/** The panel uses the same one-cell rendering path as notebook HTML export. */
export const createHtmlFromRpcResult = async (
  target: RpcInvokeTarget,
  requestJson: string,
  result: RpcNotebookResult,
  fsPath: string,
  omittedRequestCount = 0,
  metadataJson = "{}"
): Promise<string> => {
  const cell: ReportCell = {
    kind: NotebookCellKind.Code,
    document: { languageId: "rpc-json", getText: () => requestJson },
    metadata: {
      connectionName: target.connectionName,
      rpc: {
        version: 2,
        id: "report",
        service: target.service,
        method: target.method,
        path: target.path,
        callKind: getRpcCallKind(target),
        metadataJson,
      },
      ...(omittedRequestCount > 0 && {
        cellLabel: `${omittedRequestCount} earlier sent messages omitted from request`,
      }),
    },
    outputs: [new NotebookCellOutput([NotebookCellOutputItem.json(result, RPC_RESPONSE_MIME)])],
  };
  return createHtml([cell], fsPath, {
    isCellOrigin: false,
    rpcDescriptions: new Map([
      [cell, { request: target.requestDescription, response: target.responseDescription }],
    ]),
  });
};

const readRpcResult = (output: NotebookCellOutput): RpcNotebookResult | undefined => {
  const item = output.items.find((it) => it.mime === RPC_RESPONSE_MIME);
  if (!item) {
    return undefined;
  }
  try {
    const data: unknown = item.data;
    const value: unknown =
      data instanceof Uint8Array ? JSON.parse(Buffer.from(data).toString("utf8")) : data;
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const result = value as Partial<RpcNotebookResult>;
    if (
      result.version !== 1 ||
      result.kind !== "response" ||
      !["running", "success", "error", "cancelled", "timeout"].includes(result.outcome ?? "") ||
      typeof result.elapsedMs !== "number" ||
      typeof result.receivedCount !== "number"
    ) {
      return undefined;
    }
    return result as RpcNotebookResult;
  } catch {
    return undefined;
  }
};

// JSON escape sequences preserve the value while preventing a string containing
// a Markdown code fence from ending the report template's highlighted code block.
const safeRpcCode = (value: string): string => value.replace(/`/g, "\\u0060");
const rpcJson = (value: unknown): string => safeRpcCode(JSON.stringify(value, null, 2) ?? "null");

const rpcRequestTitle = (cell: ReportCell): string => {
  const rpc = (
    cell.metadata as
      | {
          rpc?: {
            callKind?: string;
            service?: string;
            method?: string;
          };
        }
      | undefined
  )?.rpc;
  const kind = rpc?.callKind || "RPC";
  const path = rpc?.service && rpc?.method ? ` ${rpc.service}/${rpc.method}` : "";
  return `${kind}${path}`;
};

const rpcResultSummary = (result: RpcNotebookResult): string => {
  const status = result.status ? `${formatRpcStatus(result.status)} · ` : "";
  return `${status}${formatRpcTransferSummary(
    result.receivedCount,
    result.elapsedMs,
    result.sentCount
  )}`;
};

const appendRpcTabs = (html: string[], tabClass: string, tabs: readonly string[]): void => {
  html.push('<div class="tabs is-boxed is-small"><ul>');
  for (const [index, tab] of tabs.entries()) {
    const title = tab[0].toUpperCase() + tab.slice(1);
    html.push(
      `<li${
        index === 0 ? ' class="is-active"' : ""
      }><a data-tab="${tab}" data-id-class="${tabClass}">${title}</a></li>`
    );
  }
  html.push("</ul></div>");
};

const appendRpcPane = (html: string[], tabClass: string, tab: string, contents: string[]): void => {
  html.push(
    `<div id="${tabClass}-${tab}" class="block ${tabClass}"${
      tab === "data" ? "" : ' style="display:none;"'
    }>`
  );
  html.push(...contents);
  html.push("</div>");
};

const appendRpcResult = (
  result: RpcNotebookResult,
  html: string[],
  markdownValues: MarkdownValues,
  id: string,
  responseDescription?: string
): void => {
  const color =
    result.outcome === "success"
      ? "is-primary"
      : result.outcome === "running"
      ? "is-warning"
      : "is-danger";
  html.push(
    `<div class="notification ${color} is-light" style="padding:10px; margin-bottom:10px;font-size:small;"><span class="tag ${color} is-light">RPC Result</span> ${escapeHtml(
      rpcResultSummary(result)
    )}</div>`
  );
  if (result.error) {
    html.push(`<div class="notification is-danger is-light">${escapeHtml(result.error)}</div>`);
  }
  const tabClass = `${id}_tab`;
  appendRpcTabs(html, tabClass, ["data", "headers", "trailers", "descriptor"]);

  const addJson = (pane: string[], value: unknown, suffix: string, label?: string): void => {
    const codeId = `${id}_${suffix}`;
    if (label) {
      pane.push(`<h5 class="subtitle is-6">${escapeHtml(label)}</h5>`);
    }
    pane.push(`<div id="${codeId}" class="block"></div>`);
    markdownValues[codeId] = { lang: "json", s: escapeHtml(rpcJson(value)) };
  };
  const data: string[] = [];
  if (result.contents !== undefined) {
    addJson(data, result.contents, "data");
  } else if (result.messages?.length) {
    for (const [index, message] of result.messages.entries()) {
      addJson(
        data,
        message.contents,
        `message_${index}`,
        `#${message.index} · ${new Date(message.at).toLocaleString()}`
      );
    }
  } else {
    data.push("<p>No messages</p>");
  }
  if (result.droppedCount) {
    data.push(
      `<p>${escapeHtml(
        String(result.droppedCount)
      )} older messages omitted. Only retained messages are shown.</p>`
    );
  }
  const headers: string[] = [];
  if (result.headers) {
    addJson(headers, result.headers, "headers");
  } else {
    headers.push("<p>No headers</p>");
  }
  const trailers: string[] = [];
  if (result.trailers) {
    addJson(trailers, result.trailers, "trailers");
  } else {
    trailers.push("<p>No trailers</p>");
  }

  const descriptor: string[] = [`<div id="${id}_descriptor" class="block"></div>`];
  markdownValues[`${id}_descriptor`] = {
    lang: "protobuf",
    s: escapeHtml(safeRpcCode(responseDescription || "Descriptor unavailable")),
  };

  for (const [tab, contents] of [
    ["data", data],
    ["headers", headers],
    ["trailers", trailers],
    ["descriptor", descriptor],
  ] as const) {
    appendRpcPane(html, tabClass, tab, contents);
  }
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
  cells: ReportCell[],
  fsPath: string,
  options: CreateHtmlOptionsParams
): Promise<string> => {
  const { isCellOrigin } = options;
  // A generated DBN has an in-notebook TOC for easier reading. HTML already
  // supplies its own navigation panel, so omit cells explicitly marked as
  // DBN-only to avoid showing two TOCs.
  const renderedCells = cells.filter(
    (cell) => !(cell.metadata as CellMeta | undefined)?.excludeFromHtml
  );
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
      renderedCells.forEach((cell, idx) => {
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
    renderedCells.forEach((cell, idx) => {
      const cellMeta: CellMeta = cell.metadata;
      const cellLabel = cellMeta.cellLabel;
      const cellTitle = `${isCellOrigin ? "CELL" : "No"}${idx + 1}`;
      htmlContents.push(`<hr class="cellIdx${idx}" />`);
      const id = `id${idx}`;

      htmlContents.push(`<div class="wrapper cellIdx${idx} compact" >`);

      if (cellMeta.publishParams?.topicName) {
        const subscriptionName = cellMeta.publishParams.topicName ?? "";
        htmlContents.push(
          `<h4 class="title is-4" ><a name="cell${
            idx + 1
          }">${cellTitle}<span style="padding:10px; font-size:medium;">TOPIC: ${escapeHtml(
            subscriptionName
          )}</span></a></h4>`
        );
      } else {
        htmlContents.push(`<h4 class="title is-4" ><a name="cell${idx + 1}">${cellTitle}</a></h4>`);
      }
      if (cellLabel) {
        htmlContents.push(`<h5 class="subtitle is-5">${escapeHtml(cellLabel)}</h5>`);
      }
      if (cell.kind === NotebookCellKind.Markup) {
        htmlContents.push(`<div id="${id}" class="block">`);
        htmlContents.push("</div>");
        markdownValues[id] = { lang: "Markup", s: escapeHtml(cell.document.getText()) };
      } else {
        if (cell.document.languageId === "rpc-json") {
          htmlContents.push(`<p class="subtitle is-6">${escapeHtml(rpcRequestTitle(cell))}</p>`);
          const tabClass = `${id}_request_tab`;
          const source = decodeRpcCellSource(
            cell.document.getText(),
            isRpcCellMetadata(cell.metadata) ? cell.metadata : undefined
          );
          appendRpcTabs(htmlContents, tabClass, ["data", "metadata", "descriptor"]);
          appendRpcPane(htmlContents, tabClass, "data", [`<div id="${id}" class="block"></div>`]);
          const metadataId = `${id}_request_metadata`;
          appendRpcPane(htmlContents, tabClass, "metadata", [
            `<div id="${metadataId}" class="block"></div>`,
          ]);
          markdownValues[metadataId] = {
            lang: "json",
            s: escapeHtml(safeRpcCode(source.metadataJson)),
          };
          const descriptorId = `${id}_request_descriptor`;
          appendRpcPane(htmlContents, tabClass, "descriptor", [
            `<div id="${descriptorId}" class="block"></div>`,
          ]);
          markdownValues[descriptorId] = {
            lang: "protobuf",
            s: escapeHtml(
              safeRpcCode(options.rpcDescriptions?.get(cell)?.request || "Descriptor unavailable")
            ),
          };
          markdownValues[id] = { lang: "json", s: escapeHtml(safeRpcCode(source.dataJson)) };
        } else {
          let sentRequest:
            | NonNullable<RunResultMetadata["axiosEvent"]>["entry"]["request"]
            | undefined;
          if (cell.document.languageId === "rest-json") {
            const rest = (cell.metadata as RestCellMeta).rest;
            sentRequest = cell.outputs
              .map((output) => (output.metadata as RunResultMetadata)?.axiosEvent?.entry.request)
              .find((request) => request !== undefined);
            htmlContents.push(
              `<p class="subtitle is-6">${escapeHtml(
                `${sentRequest?.method ?? rest?.method ?? "GET"} ${
                  sentRequest?.url ?? rest?.url ?? "URL not set"
                }`
              )}</p>`
            );
            if (sentRequest?.headers.length) {
              htmlContents.push(
                `<details><summary>Sent request headers</summary><pre>${escapeHtml(
                  sentRequest.headers.map(({ name, value }) => `${name}: ${value}`).join("\n")
                )}</pre></details>`
              );
            }
          }
          htmlContents.push(`<div id="${id}" class="block">`);
          htmlContents.push("</div>");
          markdownValues[id] = {
            lang: toHljsLanguage(cell.document.languageId),
            s: escapeHtml(sentRequest?.postData?.text ?? cell.document.getText()),
          };
        }

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
            const rpcResult = readRpcResult(output);
            output.items.forEach((item) => {
              switch (item.mime) {
                case "text/plain":
                case "application/vnd.code.notebook.stdout":
                  {
                    if (
                      cell.document.languageId !== "sql" &&
                      !rpcResult &&
                      !(
                        cell.document.languageId === "rest-json" &&
                        (output.metadata as RunResultMetadata)?.axiosEvent
                      )
                    ) {
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
            if (rpcResult) {
              appendRpcResult(
                rpcResult,
                htmlContents,
                markdownValues,
                `${id}_${oidx}_rpc`,
                options.rpcDescriptions?.get(cell)?.response
              );
            }
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
                const reportChart = isReportChartSpec(cellMeta.reportChart)
                  ? cellMeta.reportChart
                  : undefined;
                const legacyChart = cellMeta.chart;
                if (outputCondig.html.displayGraphs && (legacyChart || reportChart)) {
                  const chartId = `id_chart_${idx}_${idx2++}`;
                  if (reportChart) {
                    const prepared = createReportChartViewParams(reportChart, rdh);
                    chartValues[chartId] = escapeHtml(
                      JSON.stringify({
                        type: prepared.type,
                        data: prepared.preparedData,
                        options: prepared.preparedOptions,
                      })
                    );
                    htmlContents.push(
                      `<div class="block chart"><canvas id="${chartId}" width="400" height="400"></canvas></div>`
                    );
                    return;
                  }
                  const params: ChartsViewParams = { ...legacyChart!, rdh };
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
                let responseMarkdown: string;
                try {
                  responseMarkdown = createResponseBodyMarkdown(
                    metadata.axiosEvent,
                    outputCondig.maxCharactersInCell
                  );
                } catch {
                  const response = metadata.axiosEvent.entry.response;
                  responseMarkdown = `${response.status} ${response.statusText}\n\n${
                    response.content.text ?? ""
                  }`;
                }
                markdownValues[mdId] = {
                  lang: "Markup",
                  s: escapeHtml(responseMarkdown),
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
          if (
            ["rpc-json", "rest-json"].includes(cell.document.languageId) &&
            cell.outputs.length === 0
          ) {
            htmlContents.push(`<p>Response · Not executed</p>`);
          }
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
              <small>${escapeHtml(fsPath)}</small>
            </p>`);
    reportText = reportText.replace(/<!-- __FOOTER_CONTENTS__ -->/, htmlContents.join("\n"));

    //__CUSTOM_SCRIPT__
    htmlContents = [];
    htmlContents.push(`<script>
  var markdownValues = ${JSON.stringify(markdownValues)};
  var chartValues = ${JSON.stringify(chartValues)};
  var numOfContents = ${renderedCells.length};
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

const getTocInfoHtml = (cell: ReportCell): string => {
  if (cell.kind === NotebookCellKind.Markup) {
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

  if (cell.document.languageId === "rpc-json") {
    const rpc = (cell.metadata as CellMeta & { rpc?: { service?: string; method?: string } }).rpc;
    const method =
      rpc?.service && rpc?.method ? ` ${escapeHtml(`${rpc.service}/${rpc.method}`)}` : "";
    const skipped = cell.outputs.some(
      (it) =>
        (it.metadata as RunResultMetadata)?.status === "skipped" &&
        (it.metadata as RunResultMetadata)?.lmResult === undefined
    );
    if (skipped) {
      return `${s}<span class="tag is-warning is-light">Skipped</span>${method}${labelText}`;
    }
    const rpcResult = cell.outputs.map(readRpcResult).find((it) => it !== undefined);
    if (!rpcResult) {
      const hasError = cell.outputs.some(
        (output) =>
          (output.metadata as RunResultMetadata)?.status === "error" ||
          output.items.some((item) =>
            [
              "application/vnd.code.notebook.stderr",
              "application/vnd.code.notebook.error",
            ].includes(item.mime)
          )
      );
      const status = cell.outputs.length === 0 ? "Not executed" : hasError ? "Error" : "Executed";
      const color = cell.outputs.length === 0 ? "is-info" : hasError ? "is-danger" : "is-primary";
      return `${s}<span class="tag ${color} is-light">${status}</span>${method}${labelText}`;
    }
    const outcome = {
      success: ["Executed", "is-primary"],
      error: ["Error", "is-danger"],
      timeout: ["Timeout", "is-danger"],
      cancelled: ["Cancelled", "is-warning"],
      running: ["Running", "is-warning"],
    }[rpcResult.outcome];
    return (
      `${s}<span class="tag ${outcome[1]} is-light">${outcome[0]}</span>${method}` +
      `<span class="tag is-primary is-light">RPC Result</span> ${escapeHtml(
        rpcResultSummary(rpcResult)
      )}${labelText}`
    );
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
    s += '<span class="tag is-primary is-light">Executed</span>';
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
