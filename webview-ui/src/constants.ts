import type { SecondaryItem } from "./types/Components";

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

export const WRITE_TO_CLIP_BOARD_DETAIL_ITEMS: SecondaryItem[] = [];

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
      fileType,
      outputWithType: "none",
    },
  });
  WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
    kind: "selection",
    label: `same as above (with type, comment)`,
    value: {
      fileType,
      outputWithType: "both",
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
    specifyDetail: true,
  },
});
