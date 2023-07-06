<script setup lang="ts">
import { ref } from "vue";
import { vscode } from "@/utilities/vscode";
import type { ViewConditionParams, ViewConditionUiItem } from "@/utilities/vscode";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import type { DbTable, ViewConditionItem } from "@l-v-yonsama/multi-platform-database-drivers";
import type { DropdownItem } from "@/types/Components";

type Props = {
  tableRes: DbTable;
  numOfRows: number;
  limit: number;
};

const props = defineProps<Props>();
const andOrSwitch = ref("and" as "and" | "or");

const andOrItems = [
  { label: "AND", value: "and" },
  { label: "OR", value: "or" },
];

const operatorItems: DropdownItem[] = [
  { label: "-", value: "" },
  { label: "IS NULL", value: "isNull" },
  { label: "IS NOT NULL", value: "isNotNull" },
  { label: "=", value: "equal" },
  { label: "≠", value: "notEqual" },
  { label: "<", value: "lessThan" },
  { label: "≦", value: "lessThanInclusive" },
  { label: ">", value: "greaterThan" },
  { label: "≧", value: "greaterThanInclusive" },
  { label: "LIKE", value: "like" },
  { label: "NOT LIKE", value: "notlike" },
  { label: "IN", value: "in" },
  { label: "NOT IN", value: "notIn" },
];

const columnItems = props.tableRes.children.map((it) => ({
  value: it.name,
  label: it.comment ? `${it.name} (${it.comment})` : it.name,
}));
columnItems.unshift({
  label: "-",
  value: "",
});

const limit = ref(props.limit);
const limitMax = Math.min(100000, props.numOfRows);

const conditions = ref([] as ViewConditionUiItem[]);

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const ok = (editable: boolean) => {
  const andOr = andOrSwitch.value;
  const params: ViewConditionParams = {
    conditions: JSON.parse(JSON.stringify(conditions.value)),
    andOr,
    limit: limit.value,
    editable,
  };
  vscode.postCommand({
    command: "ok",
    params,
  });
};

const addCondition = () => {
  conditions.value.push({
    column: "",
    operator: "equal",
    value: "",
  });
};

const deleteCondition = (idx: number) => {
  conditions.value.splice(idx, 1);
};
</script>

<template>
  <section class="condition-root">
    <div class="toolbar">
      <div class="tool-left">
        <label for="tableName">Table:</label>
        <span id="tableName"
          >{{ props.tableRes.name
          }}{{
            (props.tableRes.comment ?? "").length > 0 ? ` (${props.tableRes.comment})` : ""
          }}</span
        >
        <label for="numOfRows">Current rows:</label>
        <span id="numOfRows">{{ props.numOfRows }}</span>
        <label for="limit">Limit:</label>
        <VsCodeTextField
          id="limit"
          v-model="limit"
          :min="0"
          :max="limitMax"
          style="width: 100px"
          type="number"
          title="number of rows returned"
          placeholder="number of rows returned"
        >
        </VsCodeTextField>
      </div>
      <div class="tool-right">
        <VsCodeButton
          @click="cancel"
          appearance="secondary"
          title="Cancel"
          style="margin-right: 5px"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton
          @click="ok(true)"
          appearance="secondary"
          title="Retlieve in editable mode"
          style="margin-right: 5px"
          ><fa icon="pencil" />Retlieve in editable mode</VsCodeButton
        >
        <VsCodeButton @click="ok(false)" title="Retlieve"><fa icon="check" />Retlieve</VsCodeButton>
      </div>
    </div>
    <div class="editor">
      <fieldset class="conditions">
        <legend>
          <label style="margin-right: 30px">Conditions: </label>
          <VsCodeDropdown
            v-model="andOrSwitch"
            :items="andOrItems"
            style="margin-right: 5px"
          ></VsCodeDropdown>
          <VsCodeButton
            @click="addCondition"
            title="Add condition"
            appearance="secondary"
            style="margin-left: 2px"
            ><fa icon="plus" />Add condition</VsCodeButton
          >
        </legend>
        <table v-if="conditions.length > 0">
          <thead>
            <tr>
              <th class="col">Column</th>
              <th class="ope">Operator</th>
              <th class="val">Value</th>
              <th class="ctl">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) of conditions" :key="idx">
              <td class="col">
                <VsCodeDropdown
                  v-model="item.column"
                  :items="columnItems"
                  :transparent="true"
                  :required="true"
                  style="width: 100%"
                ></VsCodeDropdown>
              </td>
              <td class="ope">
                <VsCodeDropdown
                  v-model="item.operator"
                  :items="operatorItems"
                  :transparent="true"
                  :required="true"
                  style="width: 100%"
                ></VsCodeDropdown>
              </td>
              <td class="val">
                <VsCodeTextField
                  v-if="item.operator !== 'isNull' && item.operator !== 'isNotNull'"
                  v-model="item.value"
                  :maxlength="256"
                  :transparent="true"
                  :required="true"
                  style="width: 100%"
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
      </fieldset>
    </div>
  </section>
</template>

<style scoped>
section.condition-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
section.condition-root > div {
  margin: 5px;
}
div.toolbar {
  margin-bottom: 20px !important;
}

.tool-left label {
  margin-left: 25px;
  margin-right: 5px;
}
.tool-left span {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 180px;
}
table {
  width: 100%;
}
.ctl {
  width: 80px;
  max-width: 80px;
}
.col {
  width: 320px;
}

.ope {
  width: 122px;
  max-width: 122px;
  text-align: center;
}
</style>
