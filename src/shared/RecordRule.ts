import type { TableRule, TableRuleDetail } from "@l-v-yonsama/rdh";

export type RecordRule = {
  tableRule: TableRule;
  editor: RecordRuleEditorPart;
};

export type RecordRuleEditorPart = {
  visible: boolean;
  connectionName: string;
  schemaName: string;
  tableName: string;
  item?: TableRuleDetail;
  editingItemIndex?: number;
  keyword?: string;
};

export type ConditionProperties = {
  fact: string;
  operator: string;
  value: { fact: string } | any;
  path?: string;
  priority?: number;
  params?: {
    valType: "static" | "column";
    valColumn: string;
    [key: string]: any;
  };
};

export type NestedCondition = ConditionProperties | TopLevelCondition;
export type AllConditions = { all: NestedCondition[] };
export type AnyConditions = { any: NestedCondition[] };
export type TopLevelCondition = AllConditions | AnyConditions;
