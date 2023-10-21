import { abbr } from "@l-v-yonsama/multi-platform-database-drivers";
import { NodeRunAxiosResponse } from "../shared/RunResultMetadata";

export const createResponseTitle = (res: NodeRunAxiosResponse): string => {
  let title = `\`[STATUS]\`:${res.status} ${res.statusText}`;
  const statusPrefix = Math.floor(res.status / 100);
  if (statusPrefix <= 3) {
    title += "😀";
  } else {
    title += "😱";
  }
  if (res.contentTypeInfo.contentType) {
    title += ` \`[Content-Type]\`:${res.contentTypeInfo.contentType}`;
  }
  if (res.headers["Content-Length"]) {
    title += ` \`[Content-Length]\`:${res.headers["Content-Length"]}`;
  }
  if (res.elapsedTime !== undefined) {
    title += ` \`[Elapsed Time]\`:${res.elapsedTime}msec`;
  }
  return title;
};

export const createResponseSummaryMarkdown = (res: NodeRunAxiosResponse): string => {
  const title = createResponseTitle(res);
  if (res.contentTypeInfo.contentType) {
    const { contentType, renderType } = res.contentTypeInfo;
    const ltype = contentType.toLowerCase();

    if (renderType === "Text") {
      let textBody = res.data;
      let lang = "sh";
      if (ltype.indexOf("application/json") >= 0) {
        lang = "json";
        textBody = JSON.stringify(res.data, null, 2);
      }
      if (ltype.startsWith("text/")) {
        lang = ltype.substring(5);
      }
      return `${title}\n\`\`\`${lang}\n${abbr(textBody, 256)}\n\`\`\``;
    } else if (renderType === "Image") {
      return `${title}\n\n\<img style='max-width:128px;max-height:64px;' src='${createImageUrl(
        res.data,
        contentType
      )}'>`;
    }
  }
  return title;
};

const createImageUrl = (stringValue: string, contentType: string): string => {
  if (contentType === "image/svg+xml") {
    return `data:image/svg+xml,${encodeURIComponent(stringValue)}`;
  }
  return `data:${contentType};base64,${stringValue}`;
};
