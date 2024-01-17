import {
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  NotebookCellData,
  NotebookCellKind,
  commands,
  env,
} from "vscode";
import { ActionCommand, WriteHttpEventToClipboardParams } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { ComponentName } from "../shared/ComponentName";
import { HttpEventPanelEventData, HttpEventPanelEventCodeBlocks } from "../shared/MessageEventData";
import { getIconPath } from "../utilities/fsUtil";
import { NodeRunAxiosEvent } from "../shared/RunResultMetadata";
import { createCodeHtmlString } from "../utilities/highlighter";
import { ContentTypeInfo, parseContentType } from "@l-v-yonsama/multi-platform-database-drivers";
import { BasePanel } from "./BasePanel";
import {
  httpEventToText,
  headersToJson,
  queryStringsToJson,
  createRdbFromCookies,
  getPathFromUrl,
} from "../utilities/httpUtil";
import { WriteHttpEventToClipboardParamsPanel } from "./WriteHttpEventToClipboardParamsPanel";
import { CREATE_NEW_NOTEBOOK } from "../constant";
import axios, { AxiosRequestConfig } from "axios";
import * as qs from "qs";

const PREFIX = "[HttpEventPanel]";

export class HttpEventPanel extends BasePanel {
  public static currentPanel: HttpEventPanel | undefined;
  private item: NodeRunAxiosEvent | undefined;

  protected constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    HttpEventPanel.currentPanel = new HttpEventPanel(panel, extensionUri);
  }

  getComponentName(): ComponentName {
    return "HttpEventPanel";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "writeHttpEventToClipboard":
        this.writeToClipboard(params);
        break;
      case "createRequestScript":
        this.createRequestScript();
        break;
    }
  }

  private async createRequestScript() {
    if (!this.item) {
      return;
    }

    const lines: string[] = [];

    const { request, response } = this.item.entry;

    lines.push(`const url = '${request.url}'`);

    const config: AxiosRequestConfig = {
      headers: headersToJson(request.headers, true),
    };

    const contentTypeInfo = parseContentType({
      contentType: response?.content?.mimeType,
      fileName: getPathFromUrl(request?.url),
    });

    if (!contentTypeInfo.isTextValue) {
      config.responseType = "arraybuffer";
    }

    const method = request.method.toLocaleLowerCase();

    if (request.postData?.text && (method === "put" || method === "patch" || method === "post")) {
      const { mimeType, text, params } = request.postData;
      if (mimeType.indexOf("json") >= 0) {
        try {
          config.data = JSON.parse(text);
        } catch (_) {
          config.data = text;
        }
      } else if (mimeType.startsWith("application/x-www-form-urlencoded") && params) {
        config.data = qs.stringify(params, { arrayFormat: "repeat" });
      } else {
        config.data = text;
      }
    }

    lines.push(`const res = await axios.${method}(url, ${JSON.stringify(config, null, 2)});`);

    lines.push("writeResponseData(res);");

    const cell = new NotebookCellData(NotebookCellKind.Code, lines.join("\n") + "\n", "javascript");

    await commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);

    this.dispose();
  }

  private async writeToClipboard(params: WriteHttpEventToClipboardParams) {
    if (!this.item) {
      return;
    }
    if (params.specifyDetail === true) {
      WriteHttpEventToClipboardParamsPanel.render(this.extensionUri, this.item, params);
    } else {
      await env.clipboard.writeText(httpEventToText(this.item?.entry, params));
    }
  }

  protected preDispose(): void {
    HttpEventPanel.currentPanel = undefined;
  }

  public static render(extensionUri: Uri, title: string, item: NodeRunAxiosEvent) {
    log(`${PREFIX} render title:[${title}]`);
    if (HttpEventPanel.currentPanel) {
      HttpEventPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "HttpEventPanelType",
        "HttpEventPanel",
        ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      panel.iconPath = getIconPath("output.svg");
      HttpEventPanel.currentPanel = new HttpEventPanel(panel, extensionUri);
    }

    HttpEventPanel.currentPanel.renderSub(title, item);
  }

  async renderSub(title: string, item: NodeRunAxiosEvent): Promise<void> {
    this.item = item;
    this.loading(0);

    let codeBlocks: HttpEventPanelEventCodeBlocks = {
      req: {
        headers: undefined,
        params: undefined,
        contents: undefined,
        previewContentTypeInfo: undefined,
        cookies: undefined,
      },
      res: {
        headers: undefined,
        contents: undefined,
        previewContentTypeInfo: undefined,
        cookies: undefined,
      },
    };

    if (item.entry?.request) {
      const { headers, queryString, postData, cookies } = item.entry.request;

      if (cookies && cookies.length > 0) {
        codeBlocks.req.cookies = createRdbFromCookies(cookies).build();
      }

      if (headers) {
        codeBlocks.req.headers = await createCodeHtmlString({
          code: JSON.stringify(headersToJson(headers), null, 2),
          lang: "json",
        });
      }

      if (queryString?.length > 0) {
        codeBlocks.req.params = await createCodeHtmlString({
          code: JSON.stringify(queryStringsToJson(queryString), null, 2),
          lang: "json",
        });
      }

      this.loading(25);

      if (postData) {
        const contentTypeInfo = parseContentType({
          contentType: postData.mimeType,
        });
        codeBlocks.req.previewContentTypeInfo = contentTypeInfo;

        if (contentTypeInfo.isTextValue && postData.text) {
          if (contentTypeInfo.shortLang === "json") {
            try {
              codeBlocks.req.contents = await createCodeHtmlString({
                code: JSON.stringify(JSON.parse(postData.text), null, 2),
                lang: contentTypeInfo.shortLang ?? "text",
              });
            } catch (_) {
              codeBlocks.req.contents = await createCodeHtmlString({
                code: postData.text,
                lang: "text",
              });
            }
          } else {
            codeBlocks.req.contents = await createCodeHtmlString({
              code: postData.text,
              lang: contentTypeInfo.shortLang ?? "text",
            });
          }
        } else {
          codeBlocks.req.contents = await createCodeHtmlString({
            code: JSON.stringify(postData, null, 2),
            lang: "json",
          });
        }
      }
    }
    this.loading(50);

    if (item.entry?.response) {
      const { headers, content, cookies } = item.entry.response;

      if (cookies && cookies.length > 0) {
        codeBlocks.res.cookies = createRdbFromCookies(cookies).build();
      }

      if (headers) {
        codeBlocks.res.headers = await createCodeHtmlString({
          code: JSON.stringify(headersToJson(headers), null, 2),
          lang: "json",
        });
      }

      this.loading(75);

      if (content) {
        const contentTypeInfo = parseContentType({
          contentType: content.mimeType,
          fileName: item.entry.request?.url,
        });

        codeBlocks.res.previewContentTypeInfo = contentTypeInfo;

        if (contentTypeInfo.isTextValue && content.text) {
          if (contentTypeInfo.shortLang === "json") {
            try {
              codeBlocks.res.contents = await createCodeHtmlString({
                code: JSON.stringify(JSON.parse(content.text), null, 2),
                lang: contentTypeInfo.shortLang ?? "text",
              });
            } catch (_) {
              codeBlocks.res.contents = await createCodeHtmlString({
                code: content.text,
                lang: "text",
              });
            }
          } else {
            codeBlocks.res.contents = await createCodeHtmlString({
              code: content.text,
              lang: contentTypeInfo.shortLang ?? "text",
            });
          }
        } else {
          codeBlocks.res.contents = await createCodeHtmlString({
            code: JSON.stringify(content, null, 2),
            lang: "json",
          });
        }
      }

      this.loading(100);
    }

    const msg: HttpEventPanelEventData = {
      command: "initialize",
      componentName: "HttpEventPanel",
      value: {
        initialize: {
          title,
          value: item,
          codeBlocks,
        },
      },
    };

    setTimeout(() => this.panel.webview.postMessage(msg), 150);
  }
}
