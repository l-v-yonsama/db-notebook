import type { CodeItem } from "@l-v-yonsama/multi-platform-database-drivers";

export type CodeResolverParams = {
  items: CodeItem[];
  editor: CodeEditorPart;
};

export type CodeEditorPart = {
  visible: boolean;
  connectionName: string;
  item?: CodeItem;
  editingItemIndex?: number;
  keyword?: string;
};
