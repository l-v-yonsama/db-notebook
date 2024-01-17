import type { TableRuleDetail } from "@l-v-yonsama/multi-platform-database-drivers";

export type ViewConditionParams = {
  conditions: TableRuleDetail["conditions"];
  specfyCondition: boolean;
  limit: number;
  editable: boolean;
  preview: boolean;
};
