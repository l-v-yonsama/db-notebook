import type { DropdownItem } from "@/types/Components";
import type {
  ConditionProperties,
  AllConditions,
  AnyConditions,
  TopLevelCondition,
} from "@/utilities/vscode";
import { isRecord } from "@l-v-yonsama/rdh";

export function isTopLevelCondition(params: unknown): params is TopLevelCondition {
  return isAllConditions(params) || isAnyConditions(params);
}
export function isAllConditions(params: unknown): params is AllConditions {
  return isRecord(params) && Array.isArray(params.all);
}
export function isAnyConditions(params: unknown): params is AnyConditions {
  return isRecord(params) && Array.isArray(params.any);
}
export function isConditionProperties(params: unknown): params is ConditionProperties {
  return isRecord(params) && params.fact !== undefined && params.operator !== undefined;
}

export const OPERATORS: DropdownItem[] = [
  { label: "-", value: "" },
  { label: "IS NULL", value: "isNull" },
  { label: "IS NOT NULL", value: "isNotNull" },
  { label: "=", value: "equal" },
  { label: "≠", value: "notEqual" },
  { label: "<", value: "lessThan" },
  { label: "≦", value: "lessThanInclusive" },
  { label: ">", value: "greaterThan" },
  { label: "≧", value: "greaterThanInclusive" },
  { label: "BETWEEN", value: "between" },
  { label: "∈ (IN)", value: "in" },
  { label: "∉ (NOT IN)", value: "notIn" },
  { label: "LIKE", value: "like" },
];
