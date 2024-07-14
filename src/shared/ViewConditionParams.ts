import type { TableRuleDetail } from "@l-v-yonsama/rdh";

export type ViewConditionParams = {
  conditions: TableRuleDetail["conditions"];
  specfyCondition: boolean;
  limit: number;
  editable: boolean;
  preview: boolean;
};
