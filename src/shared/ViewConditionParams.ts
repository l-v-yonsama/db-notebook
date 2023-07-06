import type { ViewConditionItemOperator } from "@l-v-yonsama/multi-platform-database-drivers";

export type ViewConditionParams = {
  conditions: ViewConditionUiItem[];
  limit: number;
  andOr: "and" | "or";
  editable: boolean;
};

export type ViewConditionUiItem = {
  column: string;
  operator: ViewConditionItemOperator;
  value: string;
};
