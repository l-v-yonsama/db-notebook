<template>
  <section class="condition">
    <fieldset :class="{ 'no-elements': noElements }">
      <legend>
        <span v-if="noElements" class="codicon codicon-error"></span>
        <VsCodeDropdown
          id="dbType"
          v-model="andOrSwitch"
          :items="andOrItems"
          @change="($e:Event) => handleOnChange('andOrSwitch', $e)"
        ></VsCodeDropdown>
        <VsCodeButton
          class="fillBackGround"
          @click="addCondition"
          title="Add condition"
          appearance="secondary"
          style="margin-left: 2px"
          ><fa icon="plus" />Add condition</VsCodeButton
        >
        <VsCodeButton
          class="fillBackGround"
          @click="deleteTopLevelCondition"
          title="Delete condition"
          appearance="secondary"
          style="margin-left: 2px"
          ><fa icon="trash" />Delete condition</VsCodeButton
        >
        <VsCodeButton
          class="fillBackGround"
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
            <th class="com">Comment</th>
            <th class="ctl">Control</th>
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
                style="width: 320px"
              ></VsCodeDropdown>
            </td>
            <td class="ope">
              <VsCodeDropdown
                v-model="conditionList[idx].operator"
                :items="operatorItems"
                :transparent="true"
                :required="true"
                @change="changeCondition"
              ></VsCodeDropdown>
            </td>
            <td class="val">
              <div style="display: flex; column-gap: 5px">
                <VsCodeDropdown
                  v-show="
                    conditionList[idx].operator !== 'isNull' &&
                    conditionList[idx].operator !== 'isNotNull' &&
                    conditionList[idx].operator !== 'isNil' &&
                    conditionList[idx].operator !== 'isNotNil'
                  "
                  v-model="conditionList[idx].params!.valType"
                  :items="valTypeItems"
                  :transparent="true"
                  :required="true"
                  style="margin-right: 3px"
                  @change="changeCondition({ name: 'valType', condition })"
                ></VsCodeDropdown>
                <VsCodeTextField
                  v-if="
                  conditionList[idx].params!.valType === 'static' &&
                  conditionList[idx].operator !== 'isNull' &&
                  conditionList[idx].operator !== 'isNotNull' &&
                  conditionList[idx].operator !== 'isNil' &&
                  conditionList[idx].operator !== 'isNotNil'
                "
                  v-model="conditionList[idx].value"
                  :maxlength="256"
                  :transparent="true"
                  :required="true"
                  style="flex-grow: 1"
                  @change="changeCondition()"
                ></VsCodeTextField>
                <VsCodeDropdown
                  v-if="
                  conditionList[idx].params!.valType === 'column' &&
                  conditionList[idx].operator !== 'isNull' &&
                  conditionList[idx].operator !== 'isNotNull' &&
                  conditionList[idx].operator !== 'isNil' &&
                  conditionList[idx].operator !== 'isNotNil'
                "
                  v-model="conditionList[idx].params!.valColumn"
                  :items="columnItems"
                  :transparent="true"
                  :required="true"
                  @change="changeCondition({ name: 'valColumn', condition })"
                  style="flex-grow: 1"
                ></VsCodeDropdown>
              </div>
            </td>
            <td class="com">
              <VsCodeTextField
                v-model="conditionList[idx].params!.comment"
                :maxlength="256"
                @change="changeCondition()"
              ></VsCodeTextField>
            </td>
            <td class="ctl">
              <VsCodeButton
                appearance="secondary"
                class="deleteKey"
                @click="deleteCondition(idx)"
                title="Delete"
              >
                <span class="codicon codicon-trash"></span>Delete
              </VsCodeButton>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-for="(_, idx) of nestedList">
        <TopLevelCondition
          v-model="nestedList[idx]"
          :columnItems="columnItems"
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
import VsCodeTextField from "./base/VsCodeTextField.vue";
import type { DropdownItem } from "@/types/Components";
import type { TableRuleDetail } from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  ConditionProperties,
  AllConditions,
  AnyConditions,
  TopLevelCondition,
} from "@/utilities/vscode";

type Props = {
  modelValue: TableRuleDetail["conditions"];
  columnItems: DropdownItem[];
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

function isTopLevelCondition(params: any): params is TopLevelCondition {
  return isAllConditions(params) || isAnyConditions(params);
}
function isAllConditions(params: any): params is AllConditions {
  return params["all"] !== undefined && params["all"].length !== undefined;
}
function isAnyConditions(params: any): params is AnyConditions {
  return params["any"] !== undefined && params["any"].length !== undefined;
}
function isConditionProperties(params: any): params is ConditionProperties {
  return params["fact"] !== undefined && params["operator"] !== undefined;
}

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

const operatorItems: DropdownItem[] = [
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
  { label: "∈ (IN)", value: "in" },
  { label: "∉ (NOT IN)", value: "notIn" },
];

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
      comment: "",
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
</script>
<style scoped>
.fillBackGround {
  background: var(--dropdown-background);
}
fieldset {
  background-color: rgba(10, 10, 10, 0.3);
}
section.condition {
  margin-top: 17px;
}
.condition fieldset legend {
  width: -webkit-fill-available;
}
.condition fieldset legend > vscode-dropdown:first-of-type {
  margin-right: auto;
}

table {
  width: 100%;
}
.no {
  width: 60px;
  max-width: 60px;
}

.ctl {
  width: 80px;
  max-width: 80px;
}
.col {
  width: 320px;
}
.com {
  width: 110px;
  text-align: center;
}
.ope {
  width: 102px;
  max-width: 102px;
  text-align: center;
}
</style>
