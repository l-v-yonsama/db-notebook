import type { DropdownItem } from "@/types/Components";
import type {
  ConditionProperties,
  AllConditions,
  AnyConditions,
  TopLevelCondition,
} from "@/utilities/vscode";
import type { DbColumn, RdhKey } from "@l-v-yonsama/multi-platform-database-drivers";

export function isTopLevelCondition(params: any): params is TopLevelCondition {
  return isAllConditions(params) || isAnyConditions(params);
}
export function isAllConditions(params: any): params is AllConditions {
  return params["all"] !== undefined && params["all"].length !== undefined;
}
export function isAnyConditions(params: any): params is AnyConditions {
  return params["any"] !== undefined && params["any"].length !== undefined;
}
export function isConditionProperties(params: any): params is ConditionProperties {
  return params["fact"] !== undefined && params["operator"] !== undefined;
}

export const OPERATORS: DropdownItem[] = [
  { label: "-", value: "" },
  { label: "IS NULL", value: "isNull" },
  { label: "IS NOT NULL", value: "isNotNull" },
  { label: "IS NIL", value: "isNil" },
  { label: "IS NOT NIL", value: "isNotNil" },
  { label: "=", value: "equal" },
  { label: "≠", value: "notEqual" },
  { label: "<", value: "lessThan" },
  { label: "≦", value: "lessThanInclusive" },
  { label: ">", value: "greaterThan" },
  { label: "≧", value: "greaterThanInclusive" },
  { label: "STARTS WITH", value: "startsWith" },
  { label: "ENDS WITH", value: "endsWith" },
  { label: "BETWEEN", value: "between" },
  { label: "∈ (IN)", value: "in" },
  { label: "∉ (NOT IN)", value: "notIn" },
  // only view condition
  { label: "LIKE", value: "like" },
];

export const RULE_BASE_OPERATORS = OPERATORS.filter((it) => {
  if (it.value === "like") {
    return false;
  }
  return true;
});

export const VIEW_CONDITIONAL_OPERATORS = OPERATORS.filter((it) => {
  if (
    it.value === "isNil" ||
    it.value === "isNotNil" ||
    it.value === "startsWith" ||
    it.value === "endsWith"
  ) {
    return false;
  }
  return true;
});

export function conditionsToString(
  condition: TopLevelCondition,
  columns: DbColumn[],
  indent = ""
): string {
  let s = "";
  const nestedList = [];
  if (isAllConditions(condition)) {
    nestedList.push(...condition.all);
    s += `${indent}AND\n`;
  } else {
    nestedList.push(...condition.any);
    s += `${indent}OR\n`;
  }
  indent += "    ";

  const withComment = (colName: string): string => {
    const key = columns.find((it) => it.name === colName);
    if (key && key.comment) {
      return `${colName}(${key.comment})`;
    }
    return colName;
  };

  for (const nest of nestedList) {
    if (isTopLevelCondition(nest)) {
      s += conditionsToString(nest, columns, indent);
    } else {
      // condition
      const { fact, value } = nest;
      const operator = OPERATORS.find((it) => it.value === nest.operator)?.label;
      if (operator) {
        if (typeof value === "object" && value?.fact && typeof value.fact === "string") {
          // column name
          s += `${indent}${withComment(fact)} ${operator} ${withComment(value.fact)}\n`;
        } else {
          // static value
          s += `${indent}${withComment(fact)} ${operator} ${value}\n`;
        }
      }
    }
  }
  return s;
}

export function hasKeywordInConditions(
  condition: TopLevelCondition,
  columns: DbColumn[],
  keyword: string
): boolean {
  const nestedList = [];
  if (isAllConditions(condition)) {
    nestedList.push(...condition.all);
  } else {
    nestedList.push(...condition.any);
  }

  for (const nest of nestedList) {
    if (isTopLevelCondition(nest)) {
      if (hasKeywordInConditions(nest, columns, keyword)) {
        return true;
      }
    } else {
      const k = keyword.toLocaleLowerCase();
      // condition
      const { fact, value } = nest;
      if (fact.toLocaleLowerCase().indexOf(k) >= 0) {
        return true;
      }
      if (typeof value === "object" && value?.fact && typeof value.fact === "string") {
        if (value.fact.toLocaleLowerCase().indexOf(k) >= 0) {
          return true;
        }
      }
    }
  }
  return false;
}
