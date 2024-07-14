<script setup lang="ts">
import {
  vscode,
  type RecordRule,
  type RecordRuleEditorEventData,
  type UpdateTextDocumentActionCommand,
} from "@/utilities/vscode";
import type { DbColumn, DbSchema } from "@l-v-yonsama/multi-platform-database-drivers";
import { computed, nextTick, onMounted, ref } from "vue";
import Paragraph from "./base/Paragraph.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

import type { DropdownItem } from "@/types/Components";
import { conditionsToString } from "@/utilities/RRuleUtil";
import type { TableRuleDetail } from "@l-v-yonsama/rdh";
import TopLevelConditionVue from "./TopLevelCondition.vue";

let recordRule: RecordRule;

const sectionHeight = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.rr-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 53, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const keyword = ref("");
const initialized = ref(false);
const visibleEditor = ref(false);
const connectionName = ref("");
const connectionItems: DropdownItem[] = [];
const editorItem = ref({
  ruleName: "",
  conditions: { all: [] },
  error: {
    column: "",
    limit: 100,
  },
});

const tableName = ref("");
const tableItems = [] as DropdownItem[];

const details = ref([] as (TableRuleDetail & { originalIndex: number })[]);

const initialize = async (v: RecordRuleEditorEventData["value"]["initialize"]) => {
  initialized.value = false;
  await nextTick();
  if (v === undefined) {
    initialized.value = true;
    return;
  }
  recordRule = v.recordRule;
  keyword.value = v.recordRule.editor.keyword ?? "";
  visibleEditor.value = v.recordRule.editor.visible;
  connectionName.value = v.recordRule.editor.connectionName;
  connectionItems.splice(0, connectionItems.length);
  connectionItems.push({
    label: "-",
    value: "",
  });
  v.connectionSettingNames.map((it) => {
    connectionItems.push({ label: it, value: it });
  });
  tableName.value = v.recordRule.tableRule.table;

  details.value.splice(0, details.value.length);

  v.recordRule.tableRule.details.forEach((it, originalIndex: number) =>
    details.value.push({
      ...it,
      originalIndex,
    })
  );

  resetTables(v.schema);
  resetColumns(v.schema as DbSchema);

  Object.assign(editorItem.value, v.recordRule.editor.item);
  initialized.value = true;

  await nextTick();
  const wrapper = document.querySelector(".rr-scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = v.scrollPos ?? 0;
  }
};

const resetTables = async (schema?: DbSchema) => {
  tableItems.splice(0, tableItems.length);
  tableItems.push({
    label: "-",
    value: "",
  });
  (schema === undefined || schema === null ? [] : schema.children).forEach((it) =>
    tableItems.push({
      label: `${it.name} ${it.comment ?? ""}`,
      value: it.name,
    })
  );
};

type ComputedDetail = {
  ruleName: string;
  errorColumn: string;
  errorLimit: number;
  conditions: string;
  originalIndex: number;
};

const computedDetails = computed((): ComputedDetail[] => {
  const list: ComputedDetail[] = [];

  details.value
    .filter((it) => {
      if (keyword.value.length === 0) {
        return true;
      }
      const k = (keyword.value ?? "").toLocaleLowerCase();
      if (
        it.ruleName.toLocaleLowerCase().indexOf(k) >= 0 ||
        it.error.column.toLocaleLowerCase().indexOf(k) >= 0
      ) {
        return true;
      }
      const cs = conditionsToString(it.conditions as any, columns.value as any, "");
      if (cs.toLocaleLowerCase().indexOf(k) >= 0) {
        return true;
      }
      return false;
    })
    .forEach((item) => {
      list.push({
        ruleName: item.ruleName,
        errorColumn: item.error.column,
        errorLimit: item.error.limit,
        conditions: conditionsToString(item.conditions as any, columns.value as any, ""),
        originalIndex: item.originalIndex,
      });
    });
  return list;
});

const columns = ref([] as DbColumn[]);
const columnItems = ref([] as DropdownItem[]);

const resetColumns = (schema?: DbSchema) => {
  columns.value.splice(0, columns.value.length);
  columnItems.value.splice(0, columnItems.value.length);
  columnItems.value.push({
    label: "-",
    value: "",
    meta: {},
  });

  if (tableName.value) {
    const tableRes = schema?.children?.find((it) => it.name === tableName.value);
    if (tableRes) {
      const children = tableRes.children.sort((a, b) => a.name.localeCompare(b.name));

      children.forEach((it) => {
        columns.value.push(it);

        let label = it.name;
        if (it.comment) {
          label += ` (${it.comment})`;
        }
        columnItems.value.push({
          label,
          value: it.name,
          meta: {
            colType: it.colType,
          },
        });
      });
    }
  }
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const createEditorParams = (): RecordRule["editor"] => {
  return {
    ...recordRule.editor,
    visible: visibleEditor.value,
    connectionName: connectionName.value,
    tableName: tableName.value,
    keyword: keyword.value,
    item: editorItem.value,
  };
};

const updateTextDocument = (values?: UpdateTextDocumentActionCommand["params"]["values"]) => {
  const obj: RecordRule = {
    tableRule: {
      table: tableName.value,
      details: details.value,
    },
    editor: createEditorParams(),
  };
  const lastKnownScrollPosition = document.querySelector(".rr-scroll-wrapper")?.scrollTop ?? 0;
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

const recieveMessage = (data: RecordRuleEditorEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section v-if="initialized" class="rr-root">
    <div v-if="visibleEditor" class="toolbar">
      <div class="tool-left">
        <label for="connectionName">Connection setting</label>
        <VsCodeDropdown
          id="connectionName"
          v-model="connectionName"
          :items="connectionItems"
          style="z-index: 7"
          @change="updateTextDocument({ name: 'change', detail: 'connectionName' })"
        />
        <label for="tableName">Table</label>
        <VsCodeDropdown
          id="tableName"
          v-model="tableName"
          :items="tableItems"
          style="z-index: 7"
          @change="updateTextDocument({ name: 'change', detail: 'tableName' })"
        />
      </div>
      <div class="tool-right">
        <VsCodeButton
          @click="updateTextDocument({ name: 'cancel' })"
          appearance="secondary"
          title="Cancel"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton @click="updateTextDocument({ name: 'save-rule' })" title="Save"
          ><fa icon="check" />Ok</VsCodeButton
        >
      </div>
    </div>
    <div v-else class="toolbar">
      <div class="tool-left">
        <label for="keyword"> <fa icon="search" style="margin-right: 3px" />Search </label>
        <VsCodeTextField
          id="keyword"
          v-model="keyword"
          :maxlength="128"
          :change-on-mouseout="true"
          title="keyword"
          placeholder="Enter a keyword"
          @change="updateTextDocument()"
        >
        </VsCodeTextField>
      </div>
      <div class="tool-right">
        <VsCodeButton @click="updateTextDocument({ name: 'add-rule' })" title="Add rule"
          ><fa icon="plus" />Add rule</VsCodeButton
        >
      </div>
    </div>
    <div class="rr-scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div v-if="visibleEditor" class="editor">
        <div class="rule-name">
          <label for="ruleName">Rule name</label>
          <VsCodeTextField
            id="ruleName"
            v-model="editorItem.ruleName"
            :maxlength="128"
            :transparent="true"
            :required="true"
            :change-on-mouseout="true"
            style="flex-grow: 1"
            @change="updateTextDocument()"
          />
        </div>
        <fieldset class="errors">
          <legend>Error information</legend>
          <label for="errorColumn">Column</label>
          <VsCodeDropdown
            id="errorColumn"
            v-model="editorItem.error.column"
            :items="columnItems"
            :transparent="true"
            :required="true"
            style="width: 420px; z-index: 5"
            @change="updateTextDocument()"
          ></VsCodeDropdown>
          <label for="errorLimit" style="margin-left: 10px">Detection limit</label>
          <VsCodeTextField
            id="errorLimit"
            v-model="editorItem.error.limit"
            :min="0"
            :max="9999999"
            :maxlength="7"
            :size="5"
            :transparent="true"
            :required="true"
            :change-on-mouseout="true"
            type="number"
            @change="updateTextDocument()"
          ></VsCodeTextField>
        </fieldset>
        <div class="conditions">
          <TopLevelConditionVue
            v-model="editorItem.conditions"
            :columnItems="columnItems"
            :rule-base-mode="true"
            :lv="0"
            @change="updateTextDocument()"
          />
        </div>
      </div>
      <section v-else class="items">
        <table>
          <thead>
            <tr>
              <th rowspan="2" class="rule-name">Rule name</th>
              <th colspan="2">Error</th>
              <th rowspan="2">Conditions</th>
            </tr>
            <tr>
              <th class="w150">Column</th>
              <th class="w100">Limit</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(detail, idx) of computedDetails" :key="idx">
              <td class="rule-name">
                <Paragraph :text="detail.ruleName" :highlight-text="keyword" />
                <div class="controller">
                  <VsCodeButton
                    @click="updateTextDocument({ name: 'edit-rule', detail: detail.originalIndex })"
                    title="Edit code"
                    appearance="secondary"
                    ><fa icon="pencil" />Edit</VsCodeButton
                  >
                  <VsCodeButton
                    @click="
                      updateTextDocument({ name: 'duplicate-rule', detail: detail.originalIndex })
                    "
                    title="Duplicate rule"
                    ><fa icon="plus" />Duplicate</VsCodeButton
                  >
                  <VsCodeButton
                    @click="
                      updateTextDocument({ name: 'delete-rule', detail: detail.originalIndex })
                    "
                    title="Delete rule"
                    appearance="secondary"
                    ><fa icon="trash" />Delete</VsCodeButton
                  >
                </div>
              </td>
              <td class="w150">
                <Paragraph :text="detail.errorColumn" :highlight-text="keyword" />
              </td>
              <td class="w100">
                {{ detail.errorLimit }}
              </td>
              <td style="white-space: pre-wrap">
                <Paragraph :text="detail.conditions" :highlight-text="keyword" />
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.rr-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
section.detail {
  margin-top: 25px;
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

.rr-scroll-wrapper {
  overflow: auto;
  flex-grow: 1;
}

section.items {
  padding: 5px;
  flex-grow: 1;
  display: flex;

  table {
    border-collapse: collapse;
    width: 100%;

    thead {
      position: sticky;
      top: 0;
      z-index: 2;
      background-color: var(--vscode-editorPane-background);
    }
  }

  th,
  td {
    border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
    padding: 2px;
    overflow: hidden;

    &.rule-name {
      position: sticky;
      left: 0;
      z-index: 1;
      min-width: 255px;
      width: 255px;
      background-color: var(--vscode-editorPane-background);

      & > .controller {
        display: flex;
        justify-content: space-between;
        visibility: hidden;
      }
      &:hover > .controller {
        visibility: visible;
      }
    }
  }

  th {
    height: 20px;
    padding: 2px;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    position: relative;
  }

  span.label {
    display: inline-block;
    vertical-align: middle;
    height: 100%;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
}

.w100 {
  width: 100px;
  max-width: 100px;
}
.w150 {
  width: 150px;
  max-width: 150px;
}
</style>
