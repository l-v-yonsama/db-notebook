<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import type { DbColumn, DbSchema } from "@l-v-yonsama/multi-platform-database-drivers";
import { vscode, type RecordRule, type UpdateTextDocumentActionCommand } from "@/utilities/vscode";

import type { DropdownItem } from "@/types/Components";
import TopLevelCondition from "./TopLevelCondition.vue";

type Props = {
  connectionSettingNames: string[];
  schema: DbSchema | undefined;
  recordRule: RecordRule;
  scrollPos: number;
};
const props = defineProps<Props>();

const sectionHeight = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 53, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
  const wrapper = document.querySelector(".scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = props.scrollPos ?? 0;
  }
});

const connectionName = ref(props.recordRule.connectionName);
const connectionItems = props.connectionSettingNames.map((it) => ({ label: it, value: it }));

const tableName = ref(props.recordRule.tableRule.table);
const tableItems =
  props.schema === undefined || props.schema === null
    ? []
    : props.schema.children.map((it) => ({
        label: `${it.name} ${it.comment ?? ""}`,
        value: it.name,
      }));

const details = ref(props.recordRule.tableRule.details);
const columns = ref([] as DbColumn[]);
const columnItems = ref([] as DropdownItem[]);

const resetColumns = () => {
  columns.value.splice(0, columns.value.length);
  columnItems.value.splice(0, columnItems.value.length);
  columnItems.value.push({
    label: "-",
    value: "",
  });

  if (tableName.value) {
    const tableRes = props.schema?.children?.find((it) => it.name === tableName.value);
    if (tableRes) {
      tableRes.children.forEach((it) => {
        columns.value.push(it);

        let label = it.name;
        if (it.comment) {
          label += ` (${it.comment})`;
        }
        columnItems.value.push({
          label,
          value: it.name,
        });
      });
    }
  }
};

resetColumns();

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const updateTextDocument = (values?: UpdateTextDocumentActionCommand["params"]["values"]) => {
  const obj: RecordRule = {
    connectionName: connectionName.value,
    schemaName: props.schema?.name ?? "",
    tableRule: {
      table: tableName.value,
      details: details.value,
    },
  };
  const lastKnownScrollPosition = document.querySelector(".scroll-wrapper")?.scrollTop ?? 0;
  const newText = JSON.stringify(obj, null, 2);
  vscode.postCommand({
    command: "updateTextDocument",
    params: {
      newText,
      values,
      scrollPos: lastKnownScrollPosition,
    },
  });
};
</script>

<template>
  <section class="root">
    <div class="toolbar">
      <div class="tool-left">
        <label for="connectionName">Connection setting</label>
        <VsCodeDropdown
          id="connectionName"
          v-model="connectionName"
          :items="connectionItems"
          @change="updateTextDocument({ name: 'change', detail: 'connectionName' })"
        />
        <label for="tableName">Table</label>
        <VsCodeDropdown
          id="tableName"
          v-model="tableName"
          :items="tableItems"
          @change="updateTextDocument({ name: 'change', detail: 'tableName' })"
        />
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cansel"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton @click="updateTextDocument({ name: 'add-rule' })" title="Add rule"
          ><fa icon="plus" />Add rule</VsCodeButton
        >
      </div>
    </div>
    <section>
      <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
        <section class="detail" v-for="(detail, idx) of details" :key="idx">
          <div class="rule-name">
            <label :for="`ruleName${idx}`">Rule name</label>
            <VsCodeTextField
              :id="`ruleName${idx}`"
              v-model="detail.ruleName"
              :maxlength="128"
              :transparent="true"
              :required="true"
              style="flex-grow: 1"
              @change="updateTextDocument()"
            />
            <VsCodeButton
              @click="updateTextDocument({ name: 'delete-rule', detail: idx })"
              title="Delete rule"
              appearance="secondary"
              ><fa icon="trash" />Delete rule</VsCodeButton
            >
            <VsCodeButton
              @click="updateTextDocument({ name: 'duplicate-rule', detail: idx })"
              title="Duplicate rule"
              ><fa icon="plus" />Duplicate rule</VsCodeButton
            >
          </div>
          <fieldset class="errors">
            <legend>Error information</legend>
            <label :for="`errorColumn${idx}`">Column</label>
            <VsCodeDropdown
              :id="`errorColumn${idx}`"
              v-model="detail.error.column"
              :items="columnItems"
              :transparent="true"
              :required="true"
              style="width: 420px"
              @change="updateTextDocument()"
            ></VsCodeDropdown>
            <label :for="`errorLimit${idx}`" style="margin-left: 10px">Detection limit</label>
            <VsCodeTextField
              :id="`errorLimit${idx}`"
              v-model="detail.error.limit"
              :min="0"
              :max="9999999"
              :maxlength="7"
              :size="5"
              :transparent="true"
              :required="true"
              type="number"
              @change="updateTextDocument()"
            ></VsCodeTextField>
          </fieldset>
          <div class="conditions">
            <TopLevelCondition
              v-model="detail.conditions"
              :columnItems="columnItems"
              @change="updateTextDocument()"
            />
          </div>
        </section>
      </div>
    </section>
  </section>
</template>

<style scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 3px;
  padding: 1px;
}
section.detail {
  margin-top: 25px;
}
.toolbar {
  padding: 3px 4px;
  margin-bottom: 13px;
  display: flex;
}
.tool-left {
  flex-grow: 1;
  align-items: center;
  display: flex;
}

div.rule-name {
  display: flex;
  align-items: center;
  column-gap: 5px;
}
fieldset.errors {
  display: flex;
  align-items: center;
  width: calc(100% - 55px);
  margin-left: 20px;
}
div.conditions {
  width: calc(100% - 30px);
  margin-left: 20px;
}
label {
  margin-right: 4px;
}
.scroll-wrapper {
  overflow: auto;
}
</style>
