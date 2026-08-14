import { parseContentType } from "@l-v-yonsama/multi-platform-database-drivers";
import {
  ContentTypeInfo,
  escapeHtml,
  GeneralColumnType,
  ResultSetDataBuilder,
} from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import { promises as fs } from "fs";
import { Cookie, Header } from "har-format";
import * as path from "path";
import { mediaDir } from "../../constant";
import { HarFileTabItem } from "../../shared/MessageEventData";
import { getOutputConfig, getToStringParamByConfig } from "../configUtil";
import { writeToResourceOnStorage } from "../fsUtil";
import { logError } from "../logger";
import { createAxiosTocInfoHtml, MarkdownValues } from "../htmlGenerator";

const PREFIX = "[utilities/html/harHtmlGenerator]";

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
