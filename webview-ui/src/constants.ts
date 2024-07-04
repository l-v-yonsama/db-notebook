import type { SecondaryItem } from "./types/Components";
import type { WriteToClipboardParams } from "./utilities/vscode";

export const WRITE_TO_CLIP_BOARD_DETAIL_ITEMS: SecondaryItem<
  Omit<WriteToClipboardParams, "tabId">
>[] = [];

["text", "markdown", "csv", "tsv"].forEach((fileType) => {
  WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
    kind: "selection",
    label: `Write to clipboard in "${fileType}"`,
    value: {
      fileType: fileType as WriteToClipboardParams["fileType"],
    },
  });
});
