import { TextDecoder } from "util";
import { NotebookCellOutput, NotebookCellOutputItem } from "vscode";
import {
  isPersistedReportOutputMetadata,
  PersistedCellOutput,
  PersistedCellOutputItem,
} from "./reportTypes";

const UTF8_MIME_TYPES = new Set(["text/plain", "text/markdown"]);

function assertSupportedItem(item: PersistedCellOutputItem): void {
  if (!UTF8_MIME_TYPES.has(item.mime) || item.encoding !== "utf8") {
    throw new Error(`Unsupported dashboard report output: ${item.mime} (${item.encoding}).`);
  }
}

function decodeUtf8(data: Uint8Array | string): string {
  if (typeof data === "string") {
    return data;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}

export function serializeReportCellOutput(output: NotebookCellOutput): PersistedCellOutput {
  if (output.metadata !== undefined && !isPersistedReportOutputMetadata(output.metadata)) {
    throw new Error("Unsupported dashboard report output metadata.");
  }
  return {
    items: output.items.map((item) => {
      if (!UTF8_MIME_TYPES.has(item.mime)) {
        throw new Error(`Unsupported dashboard report output MIME type: ${item.mime}.`);
      }
      return {
        mime: item.mime,
        encoding: "utf8",
        data: decodeUtf8(item.data),
      };
    }),
    metadata: output.metadata,
  };
}

export function deserializeReportCellOutput(output: PersistedCellOutput): NotebookCellOutput {
  return new NotebookCellOutput(
    output.items.map((item) => {
      assertSupportedItem(item);
      return NotebookCellOutputItem.text(item.data, item.mime);
    }),
    output.metadata
  );
}
