import {
  GeneralColumnType,
  ResultSetDataBuilder,
  ToStringParam,
  abbr,
  createRdhKey,
  parseContentType,
  prettyFileSize,
  prettyTime,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { NodeRunAxiosEvent } from "../shared/RunResultMetadata";
import { Cookie, Entry, Header, QueryString } from "har-format";
import dayjs = require("dayjs");
import * as os from "os";
import { WriteHttpEventToClipboardParams } from "../shared/ActionParams";

export const toNodeRunAxiosEvent = (entry: Entry): NodeRunAxiosEvent => {
  let title = `${dayjs().format("HH:mm:ss.SSS")}[${entry.response.status}]`;
  const url = new URL(entry.request.url);
  title += `[${entry.request.method}][${abbr(url.host + (url.pathname ?? ""), 16)}]`;

  return {
    title,
    entry,
  };
};

const getHeaderValue = (headers: Header[], name: string): string | undefined => {
  const ln = name.toLocaleLowerCase();
  return headers.find((it) => it.name.toLocaleLowerCase() === ln)?.value;
};

export const createResponseTitleText = (res: NodeRunAxiosEvent): string => {
  const { response } = res.entry;
  let title = `\`[STATUS]\`:${response.status} ${response.statusText}`;
  const statusPrefix = Math.floor(response.status / 100);
  if (statusPrefix <= 3) {
    title += "😀";
  } else {
    title += "😱";
  }

  if (response.content.mimeType) {
    title += ` \`[Content-Type]\`:${response.content.mimeType}`;
  }

  const contentLength = getHeaderValue(response.headers, "Content-Length");
  if (contentLength) {
    title += ` \`[Content-Length]\`:${prettyFileSize(response.content.size)}`;
  }
  if (res.entry.time !== undefined) {
    title += ` \`[Elapsed Time]\`:${prettyTime(res.entry.time)}`;
  }
  return title;
};

export const getPathFromUrl = (urlString?: string): string | undefined => {
  if (urlString === undefined || urlString === "") {
    return undefined;
  }
  try {
    const url = new URL(urlString);
    return url.pathname;
  } catch (_) {
    const idx = urlString.indexOf("?");
    if (idx > 0) {
      return urlString.substring(0, idx);
    }
    return urlString;
  }
};

export const createResponseBodyMarkdown = (res: NodeRunAxiosEvent): string => {
  const { response } = res.entry;
  const title = createResponseTitleText(res);
  if (response.content.mimeType) {
    const { renderType, shortLang, contentType } = parseContentType({
      contentType: response.content.mimeType,
      fileName: getPathFromUrl(res.entry.request?.url),
    });

    if (response.content.text) {
      const MAX_CHARS = 256;
      const NOTICE = 'Abbreviated. Push "Open response" button to show all without abbreviation.';
      if (renderType === "Text") {
        if (shortLang === "json") {
          const textBody = JSON.stringify(JSON.parse(response.content.text), null, 2);
          if (textBody.length < MAX_CHARS) {
            return `${title}\n\`\`\`json\n${textBody}\n\`\`\``;
          }
          return `${title}\n\`\`\`json\n${textBody.substring(0, MAX_CHARS)}...\n\nℹ️ (256/${
            textBody.length
          }) ${NOTICE}\n\`\`\``;
        }
        let lang = shortLang ?? "sh";
        let textBody = response.content.text + "";
        if (textBody.length < MAX_CHARS) {
          return `${title}\n\`\`\`${lang}\n${textBody}\n\`\`\``;
        }
        return `${title}\n\`\`\`${lang}\nℹ️ (256/${textBody.length}) ${abbr(
          textBody,
          MAX_CHARS
        )}\n\n${NOTICE}\n\`\`\``;
      } else if (renderType === "Image") {
        return `${title}\n\n\<img style='max-width:128px;max-height:64px;' src='${createImageUrl(
          response.content.text,
          contentType
        )}'>`;
      }
    }
  }
  return title;
};

export const httpEventToText = (entry: Entry, params: WriteHttpEventToClipboardParams): string => {
  let ret = "";
  const isMarkdown = params.fileType === "markdown";

  // Request
  if (entry.request) {
    const { headers, queryString, postData } = entry.request;

    if (params.withRequest) {
      ret += `${isMarkdown ? "###" : "▪️▪️▪"} Request ${os.EOL}`;

      ret += createHeadersText("Request Headers", headers, isMarkdown);

      ret += createQueryStringsText(queryString, isMarkdown);

      if (postData) {
        ret += createContentText({
          title: "Request Data",
          mimeType: postData?.mimeType,
          text: postData?.text ?? "",
          isMarkdown,
          withBase64: params.withBase64,
        });
      }
    }
  }

  // Response
  if (entry.response) {
    const { headers, content } = entry.response;

    if (params.withResponse) {
      ret += `${isMarkdown ? "###" : "▪️▪️▪"} Response ${os.EOL}`;

      ret += createHeadersText("Response Headers", headers, isMarkdown);

      if (content) {
        ret += createContentText({
          title: "Response Data",
          mimeType: content?.mimeType,
          fileName: getPathFromUrl(entry.request?.url),
          text: content?.text ?? "",
          isMarkdown,
          withBase64: params.withBase64,
        });
      }
    }
  }

  // Cookies
  if (params.withCookies) {
    ret += createCookiesText("Cookies", entry, isMarkdown);
  }

  return ret + os.EOL;
};

export const headersToJson = (
  headers: Header[],
  skipInvalidHeader = false
): { [key: string]: any } => {
  return headers.reduce((p, c) => {
    if (skipInvalidHeader && c.name.indexOf(":") >= 0) {
      return p;
    }
    p[c.name] = c.value;
    return p;
  }, {} as { [key: string]: any });
};

export const queryStringsToJson = (queryStrings: QueryString[]): { [key: string]: any } => {
  return queryStrings.reduce((p, c) => {
    p[c.name] = c.value;
    return p;
  }, {} as { [key: string]: any });
};

const createHeadersText = (title: string, headers: Header[], isMarkdown: boolean): string => {
  let ret = "";

  ret += `${isMarkdown ? "####" : "▪️▪️▪️▪️"} ${title} ${os.EOL}${os.EOL}`;
  if (headers && headers.length > 0) {
    if (isMarkdown) {
      ret += `\`\`\`json${os.EOL}${JSON.stringify(headersToJson(headers), null, 2)}${os.EOL}\`\`\`${
        os.EOL
      }`;
    } else {
      ret += `${os.EOL}${JSON.stringify(headersToJson(headers), null, 2)}${os.EOL}`;
    }
  } else {
    ret += `No data.${os.EOL}`;
  }
  ret += os.EOL;
  return ret;
};

const createQueryStringsText = (queryStrings: QueryString[], isMarkdown: boolean): string => {
  let ret = "";

  ret += `${isMarkdown ? "####" : "▪️▪️▪️▪️"} Request query strings ${os.EOL}${os.EOL}`;
  if (queryStrings && queryStrings.length > 0) {
    if (isMarkdown) {
      ret += `\`\`\`json${os.EOL}${JSON.stringify(headersToJson(queryStrings), null, 2)}${
        os.EOL
      }\`\`\`${os.EOL}`;
    } else {
      ret += `${os.EOL}${JSON.stringify(queryStringsToJson(queryStrings), null, 2)}${os.EOL}`;
    }
  } else {
    ret += `No data.${os.EOL}`;
  }
  ret += os.EOL;
  return ret;
};

const createContentText = ({
  title,
  mimeType,
  fileName,
  text,
  withBase64,
  isMarkdown,
}: {
  title: string;
  mimeType: string;
  fileName?: string;
  text: string;
  withBase64: boolean;
  isMarkdown: boolean;
}): string => {
  let ret = "";

  ret += `${isMarkdown ? "####" : "▪️▪️▪️▪️"} ${title} ${os.EOL}${os.EOL}`;

  const contentTypeInfo = parseContentType({
    contentType: mimeType,
    fileName,
  });
  if (contentTypeInfo.isTextValue && text) {
    if (contentTypeInfo.shortLang === "json") {
      try {
        if (isMarkdown) {
          ret += `\`\`\`json${os.EOL}${JSON.stringify(JSON.parse(text), null, 2)}${os.EOL}\`\`\`${
            os.EOL
          }`;
        } else {
          ret += JSON.stringify(JSON.parse(text), null, 2) + os.EOL;
        }
      } catch (_) {
        if (isMarkdown) {
          ret += `\`\`\`sh${os.EOL}${text}${os.EOL}\`\`\`${os.EOL}`;
        } else {
          ret += text + os.EOL;
        }
      }
    } else {
      if (isMarkdown) {
        ret += `\`\`\`${contentTypeInfo.shortLang ?? "sh"}${os.EOL}${text}${os.EOL}\`\`\`${os.EOL}`;
      } else {
        ret += text + os.EOL;
      }
    }
  } else {
    if (withBase64) {
      ret += `${text}${os.EOL}`;
    } else {
      ret += `Cannot display.${os.EOL}`;
    }
  }

  ret += os.EOL;
  return ret;
};

const createCookiesText = (title: string, entry: Entry, isMarkdown: boolean): string => {
  let ret = "";

  ret += `${isMarkdown ? "####" : "▪️▪️▪️▪️"} ${title} ${os.EOL}${os.EOL}`;

  ret += `${isMarkdown ? "#####" : "▪️▪️▪️▪️▪️"} Request Cookies ${os.EOL}`;
  ret += os.EOL;
  if (entry.request?.cookies?.length > 0) {
    ret += cookieToText(entry.request.cookies, isMarkdown);
  } else {
    ret += "No data";
  }
  ret += os.EOL;
  ret += os.EOL;
  ret += `${isMarkdown ? "#####" : "▪️▪️▪️▪️▪️"} Response Cookies ${os.EOL}`;
  ret += os.EOL;
  if (entry.response?.cookies?.length > 0) {
    ret += cookieToText(entry.response.cookies, isMarkdown);
  } else {
    ret += "No data";
  }

  ret += os.EOL;
  return ret;
};

const cookieToText = (cookies: Cookie[], isMarkdown: boolean) => {
  const rdb = createRdbFromCookies(cookies);

  const outputDetail: ToStringParam = {
    maxPrintLines: 1000,
    maxCellValueLength: 1000,
    withType: false,
    withComment: false,
    withRowNo: true,
    withCodeLabel: false,
    withRuleViolation: false,
  };

  return isMarkdown ? rdb.toMarkdown(outputDetail) : rdb.toString(outputDetail);
};

export const createRdbFromCookies = (cookies: Cookie[]): ResultSetDataBuilder => {
  const rdb = new ResultSetDataBuilder([
    createRdhKey({ name: "name", type: GeneralColumnType.TEXT, width: 100, align: "left" }),
    createRdhKey({ name: "value", type: GeneralColumnType.TEXT, width: 200, align: "left" }),
    createRdhKey({ name: "path", type: GeneralColumnType.TEXT, align: "left" }),
    createRdhKey({ name: "domain", type: GeneralColumnType.TEXT, align: "left" }),
    createRdhKey({ name: "expires", type: GeneralColumnType.TIMESTAMP }),
    createRdhKey({ name: "httpOnly", type: GeneralColumnType.BOOLEAN }),
    createRdhKey({ name: "secure", type: GeneralColumnType.BOOLEAN }),
  ]);
  cookies
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((cookie) => {
      rdb.addRow({
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        domain: cookie.domain,
        expires: cookie.expires ? dayjs(cookie.expires).toDate() : null,
        httpOnly: cookie.httpOnly,
        secure: cookie.httpOnly,
      });
    });

  return rdb;
};

const createImageUrl = (stringValue: string, contentType: string): string => {
  if (contentType === "image/svg+xml") {
    return `data:image/svg+xml,${encodeURIComponent(stringValue)}`;
  }
  return `data:${contentType};base64,${stringValue}`;
};
