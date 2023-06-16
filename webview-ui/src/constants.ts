import type { SecondaryItem } from "./types/Components";
import type { WriteToClipboardParams } from "./utilities/vscode";

export const OUTPUT_DETAIL_ITEMS: SecondaryItem<string>[] = [
  {
    kind: "selection",
    label: "Output excel (no type, comment)",
    value: "none",
  },
  {
    kind: "selection",
    label: "same as above (with type)",
    value: "withType",
  },
  {
    kind: "selection",
    label: "same as above (with comment)",
    value: "withComment",
  },
  {
    kind: "selection",
    label: "same as above (with type, comment)",
    value: "both",
  },
];

const OUTPUT_WITH_TYPES = ["none", "withComment", "withType", "both"];

export const WRITE_TO_CLIP_BOARD_DETAIL_ITEMS: SecondaryItem<
  Omit<WriteToClipboardParams, "tabId">
>[] = [];

["text", "markdown", "csv", "tsv"].forEach((fileType, idx) => {
  if (idx > 0) {
    WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
      kind: "divider",
    });
  }
  WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
    kind: "selection",
    label: `Write to clipboard in "${fileType}" Limit 10 rows (no type, comment)`,
    value: {
      fileType: fileType as WriteToClipboardParams["fileType"],
      outputWithType: "none",
      withRowNo: true,
    },
  });
  WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
    kind: "selection",
    label: `same as above (with type, comment)`,
    value: {
      fileType: fileType as WriteToClipboardParams["fileType"],
      outputWithType: "both",
      withRowNo: true,
    },
  });
});
WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
  kind: "divider",
});
WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
  kind: "selection",
  label: "Specify details",
  value: {
    fileType: "text",
    outputWithType: "withComment",
    withRowNo: true,
    specifyDetail: true,
  },
});
