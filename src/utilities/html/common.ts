import { prettyTime } from "@l-v-yonsama/multi-platform-database-drivers";
import { Response } from "har-format";

// Internal leaf module: types/helpers shared by both htmlGenerator.ts (general
// Notebook/RDH/Diff HTML export) and harHtmlGenerator.ts (HAR report export).
// Neither of those two files imports from the other for this logic, so there's
// no import cycle between them.

export type MarkdownValues = { [key: string]: { lang: string; s: string } };

// Used by both htmlGenerator.ts's getTocInfoHtml (axios cell results) and
// harHtmlGenerator.ts (HAR entries render the same status/method/URL summary
// in their TOC and per-entry heading).
export const createAxiosTocInfoHtml = (
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
