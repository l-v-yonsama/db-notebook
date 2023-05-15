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

["text", "markdown", "csv"].forEach((fileType, idx) => {
  if (idx > 0) {
    WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
      kind: "divider",
    });
  }
  WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
    kind: "selection",
    label: `Write to clipboard in "${fileType}" (no type, comment)`,
    value: {
      fileType,
      outputWithType: "none",
    },
  });
  WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
    kind: "selection",
    label: `same as above (with type)`,
    value: {
      fileType,
      outputWithType: "withType",
    },
  });
  WRITE_TO_CLIP_BOARD_DETAIL_ITEMS.push({
    kind: "selection",
    label: `same as above (with comment)`,
    value: {
      fileType,
      outputWithType: "withComment",
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
