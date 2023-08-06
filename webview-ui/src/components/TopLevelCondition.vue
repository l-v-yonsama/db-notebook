<template>
  <section class="condition">
    <fieldset :class="{ 'no-elements': noElements }">
      <legend>
        <span v-if="noElements" class="codicon codicon-error"></span>

        <VsCodeRadioGroupVue
          v-model="andOrSwitch"
          :items="andOrItems"
          @change="($e:Event) => handleOnChange('andOrSwitch', $e)"
        />

        <VsCodeButton
          @click="addCondition"
          title="Add condition"
          appearance="secondary"
          style="margin-left: 2px"
          ><fa icon="plus" />Add condition</VsCodeButton
        >
        <VsCodeButton
          v-if="lv > 0"
          @click="deleteTopLevelCondition"
          title="Delete condition"
          appearance="secondary"
          style="margin-left: 2px"
          ><fa icon="trash" />Delete condition</VsCodeButton
        >
        <VsCodeButton
          @click="addNestedCondition"
          title="Add nested condition"
          appearance="secondary"
          style="margin-left: 2px"
          ><fa icon="plus" />Add nested condition</VsCodeButton
        >
      </legend>
      <table v-if="conditionList.length > 0">
        <thead>
          <tr>
            <th class="no">No</th>
            <th class="col">Column</th>
            <th class="ope">Operator</th>
            <th class="val">Value</th>
            <th class="ctl">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(condition, idx) of conditionList">
            <td class="no">{{ idx + 1 }}</td>
            <td class="col">
              <VsCodeDropdown
                v-model="conditionList[idx].fact"
                :items="columnItems"
                :transparent="true"
                :required="true"
                @change="changeCondition"
                style="width: 310px"
              ></VsCodeDropdown>
            </td>
            <td class="ope">
              <VsCodeDropdown
                v-model="conditionList[idx].operator"
                :items="operatorItems"
                :transparent="true"
                :required="true"
                style="width: 100%"
                @change="changeCondition"
              ></VsCodeDropdown>
            </td>
            <td class="val">
              <div v-if="hasValueOperator(conditionList[idx].operator)" class="val-def">
                <VsCodeDropdown
                  v-if="selectableValType(conditionList[idx].operator)"
                  v-model="conditionList[idx].params!.valType"
                  :items="valTypeItems"
                  :transparent="true"
                  :required="true"
                  class="valType"
                  @change="changeCondition({ name: 'valType', condition })"
                ></VsCodeDropdown>
                <VsCodeTextField
                  v-if="conditionList[idx].params!.valType === 'static'"
                  v-model="conditionList[idx].value"
                  :maxlength="256"
                  :transparent="true"
                  :required="true"
                  :change-on-mouseout="true"
                  style="flex-grow: 1"
                  @change="changeCondition()"
                ></VsCodeTextField>
                <p
                  style="margin: 0 3px"
                  v-if="!selectableValType(conditionList[idx].operator)"
                  v-text="toExample(conditionList[idx])"
                ></p>
                <VsCodeDropdown
                  v-if="conditionList[idx].params!.valType === 'column' && selectableValType(conditionList[idx].operator)"
                  v-model="conditionList[idx].params!.valColumn"
                  :items="columnItems"
                  :transparent="true"
                  :required="true"
                  @change="changeCondition({ name: 'valColumn', condition })"
                  style="flex-grow: 1"
                ></VsCodeDropdown>
              </div>
            </td>
            <td class="ctl">
              <VsCodeButton
                appearance="secondary"
                class="deleteKey"
                @click="deleteCondition(idx)"
                title="Delete"
              >
                <span class="codicon codicon-trash"></span>Del
              </VsCodeButton>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-for="(_, idx) of nestedList">
        <TopLevelCondition
          v-model="nestedList[idx]"
          :columnItems="columnItems"
          :rule-base-mode="props.ruleBaseMode"
          :lv="props.lv + 1"
          @change="updateSuperTextDocument()"
          @deleteTopLevelCondition="deleteTopLevelConditionAndUpdateDocument(idx)"
        />
      </template>
    </fieldset>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import type { DropdownItem } from "@/types/Components";
import { RULE_BASE_OPERATORS, VIEW_CONDITIONAL_OPERATORS } from "@/utilities/RRuleUtil";

import type {
  ConditionProperties,
  AllConditions,
  AnyConditions,
  TopLevelCondition,
} from "@/utilities/vscode";
import {
  isAllConditions,
  isAnyConditions,
  isConditionProperties,
  isTopLevelCondition,
} from "@/utilities/RRuleUtil";
import { GeneralColumnType } from "@/types/lib/GeneralColumnType";
import { isNumericLike } from "@/utilities/GeneralColumnUtil";

type Props = {
  modelValue: any; // TableRuleDetail["conditions"];
  columnItems: DropdownItem[];
  ruleBaseMode: boolean;
  lv: number;
};
const props = defineProps<Props>();

const isAny = isAnyConditions(props.modelValue);
const andOrSwitch = ref(isAny ? "any" : "all");

const andOrItems = [
  { label: "AND", value: "all" },
  { label: "OR", value: "any" },
];

const valTypeItems = [
  { label: "-", value: "" },
  { label: "STATIC", value: "static" },
  { label: "COLUMN", value: "column" },
];

const conditionList = ref([] as ConditionProperties[]);
const nestedList = ref([] as TopLevelCondition[]);
const noElements = computed(() => conditionList.value.length + nestedList.value.length === 0);

if (isAllConditions(props.modelValue)) {
  props.modelValue.all.forEach((it) => {
    if (isConditionProperties(it)) {
      conditionList.value.push({ ...it });
    } else if (isTopLevelCondition(it)) {
      nestedList.value.push({ ...it });
    }
  });
}
if (isAnyConditions(props.modelValue)) {
  props.modelValue.any.forEach((it) => {
    if (isConditionProperties(it)) {
      conditionList.value.push({ ...it });
    } else if (isTopLevelCondition(it)) {
      nestedList.value.push({ ...it });
    }
  });
}

const operatorItems = props.ruleBaseMode ? RULE_BASE_OPERATORS : VIEW_CONDITIONAL_OPERATORS;

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: any): void;
  (event: "change"): void;
  (event: "deleteTopLevelCondition"): void;
}>();

function handleOnChange(key: string, event: any) {
  const modelValue = Object.assign(props.modelValue, {}) as any;
  if (key === "andOrSwitch") {
    if (isAny) {
      const original = (props.modelValue as any)["any"];
      delete modelValue.any;
      modelValue["all"] = original;
    } else {
      const original = (props.modelValue as any)["all"];
      delete modelValue.all;
      modelValue["any"] = original;
    }
  }
  emit("update:modelValue", modelValue);
  emit("change");
}

const changeCondition = (params?: { name: string; condition: ConditionProperties }) => {
  if (params) {
    const { name, condition } = params;
    if (name === "valType") {
      if (condition.params?.valType === "static") {
        condition.value = "";
      } else {
        condition.value = {
          fact: "",
        };
      }
    } else if (name === "valColumn") {
      condition.value = {
        fact: condition.params!.valColumn,
      };
    }
  }
  if (isAllConditions(props.modelValue)) {
    const modelValue = Object.assign(props.modelValue, {}) as AllConditions;
    modelValue.all.splice(0, modelValue.all.length);
    modelValue.all.push(...conditionList.value);
    modelValue.all.push(...nestedList.value);
    emit("update:modelValue", modelValue);
  }
  if (isAnyConditions(props.modelValue)) {
    const modelValue = Object.assign(props.modelValue, {}) as AnyConditions;
    modelValue.any.splice(0, modelValue.any.length);
    modelValue.any.push(...conditionList.value);
    modelValue.any.push(...nestedList.value);
    emit("update:modelValue", modelValue);
  }
  emit("change");
};

const deleteCondition = (idx: number) => {
  conditionList.value.splice(idx, 1);
  changeCondition();
};

const deleteTopLevelConditionAndUpdateDocument = (idx: number) => {
  nestedList.value.splice(idx, 1);
  changeCondition();
};

const deleteTopLevelCondition = () => {
  emit("deleteTopLevelCondition");
};

const addCondition = () => {
  const modelValue = Object.assign(props.modelValue, {}) as any;
  const prop: ConditionProperties = {
    fact: "",
    operator: "",
    value: "",
    params: {
      valType: "static",
      valColumn: "",
    },
  };
  if (isAny) {
    modelValue["any"].push(prop);
  } else {
    modelValue["all"].push(prop);
  }

  emit("update:modelValue", modelValue);
  emit("change");
};
const addNestedCondition = () => {
  const modelValue = Object.assign(props.modelValue, {}) as any;
  const prop: AnyConditions = {
    any: [],
  };
  if (isAny) {
    modelValue["any"].push(prop);
  } else {
    modelValue["all"].push(prop);
  }
  emit("update:modelValue", modelValue);
  emit("change");
};
const updateSuperTextDocument = () => {
  changeCondition();
};

const hasValueOperator = (ope: string): boolean => {
  return ope !== "isNull" && ope !== "isNotNull" && ope !== "isNil" && ope !== "isNotNil";
};

// レコードルール向けの場合は比較値の指定方法を選択可能
// 但し、比較値が配列になる場合は選択不可能
const selectableValType = (ope: string): boolean => {
  return props.ruleBaseMode && ope !== "between" && ope !== "in" && ope !== "notIn";
};

const toExample = (p: ConditionProperties): string => {
  const { operator, fact } = p;
  let colType = GeneralColumnType.INTEGER;
  if (fact) {
    colType =
      props.columnItems.find((it) => it.value === fact)?.meta?.colType ?? GeneralColumnType.INTEGER;
  }
  switch (operator) {
    case "like":
      return "%hoge%";
    case "between": {
      return isNumericLike(colType) ? "e.g. 10,20" : "e.g. a,b";
    }
    case "in":
    case "notIn": {
      return isNumericLike(colType) ? "e.g. 10,20,30" : "e.g. a,b,c";
    }
  }
  return "";
};
</script>
<style lang="scss" scoped>
vscode-dropdown.open {
  z-index: 20;
}
section.condition {
  margin-top: 17px;

  fieldset {
    legend {
      width: -webkit-fill-available;

      & > vscode-dropdown:first-of-type {
        margin-right: auto;
      }
    }

    table {
      width: 100%;

      .no {
        width: 60px;
        max-width: 60px;
      }
      .valType {
        margin-right: 3px;
        z-index: 4;
      }
      .ctl {
        width: 60px;
        max-width: 60px;
      }
      .col {
        width: 310px;
      }
      .com {
        width: 110px;
        text-align: center;
      }
      .ope {
        width: 130px;
        max-width: 130px;
        text-align: center;
      }
      .val-def {
        display: flex;
        column-gap: 5px;
        justify-content: center;
        align-items: center;
        width: 100%;
      }
    }
  }
}
</style>
