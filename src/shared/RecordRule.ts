import type { TableRule } from "@l-v-yonsama/multi-platform-database-drivers";

export type RecordRule = {
  connectionName: string;
  schemaName: string;
  tableRule: TableRule;
};

export type ConditionOperator =
  | "equal"
  | "notEqual"
  | "lessThan"
  | "lessThanInclusive"
  | "greaterThan"
  | "greaterThanInclusive"
  | "in"
  | "notIn";

// export type ConditionPropertiesForWeb = {
//   column: string;
//   operator: ConditionOperator;
//   value: { column: string } | any;
//   comment: string;
// };

export type ConditionProperties = {
  fact: string;
  operator: string;
  value: { fact: string } | any;
  path?: string;
  priority?: number;
  params?: {
    comment: string;
    valType: "static" | "column";
    valColumn: string;
    [key: string]: any;
  };
};

export type NestedCondition = ConditionProperties | TopLevelCondition;
export type AllConditions = { all: NestedCondition[] };
export type AnyConditions = { any: NestedCondition[] };
export type TopLevelCondition = AllConditions | AnyConditions;
