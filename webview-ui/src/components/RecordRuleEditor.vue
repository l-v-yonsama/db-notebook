<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import Paragraph from "./base/Paragraph.vue";
import type { DbColumn, DbSchema } from "@l-v-yonsama/multi-platform-database-drivers";
import { vscode, type RecordRule, type UpdateTextDocumentActionCommand } from "@/utilities/vscode";

import type { DropdownItem } from "@/types/Components";
import TopLevelConditionVue from "./TopLevelCondition.vue";
import { conditionsToString } from "@/utilities/RRuleUtil";

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
  const sectionWrapper = window.document.querySelector("section.rr-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 53, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
  const wrapper = document.querySelector(".rr-scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = props.scrollPos ?? 0;
  }
});

const keyword = ref(props.recordRule.editor.keyword ?? "");
const visibleEditor = ref(props.recordRule.editor.visible);
const connectionName = ref(props.recordRule.editor.connectionName);
const connectionItems = props.connectionSettingNames.map((it) => ({ label: it, value: it }));
const editorItem = ref(
  props.recordRule.editor.item ?? {
    ruleName: "",
    conditions: { all: [] },
    error: {
      column: "",
      limit: 100,
    },
  }
);

const tableName = ref(props.recordRule.tableRule.table);
const tableItems =
  props.schema === undefined || props.schema === null
    ? []
    : props.schema.children.map((it) => ({
        label: `${it.name} ${it.comment ?? ""}`,
        value: it.name,
      }));

const details = ref(
  props.recordRule.tableRule.details.map((it, originalIndex) => ({
    ...it,
    originalIndex,
  }))
);

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

const resetColumns = () => {
  columns.value.splice(0, columns.value.length);
  columnItems.value.splice(0, columnItems.value.length);
  columnItems.value.push({
    label: "-",
    value: "",
    meta: {},
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
          meta: {
            colType: it.colType,
          },
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

const createEditorParams = (): RecordRule["editor"] => {
  return {
    ...props.recordRule.editor,
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
</script>

<template>
  <section class="rr-root">
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

<style scoped>
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

label {
  margin-right: 4px;
}
section.items {
  padding: 5px;
  flex-grow: 1;
  display: flex;
}
.rr-scroll-wrapper {
  overflow: auto;
  flex-grow: 1;
}
section.items table {
  border-collapse: collapse;
  width: 100%;
}
section.items table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: var(--vscode-editorPane-background);
}
section.items table th {
  height: 20px;
  padding: 2px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  position: relative;
}

td.rule-name > .controller {
  display: flex;
  justify-content: space-between;
  visibility: hidden;
}
td.rule-name:hover > .controller {
  visibility: visible;
}

section.items thead th.rule-name,
section.items tbody td.rule-name {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 255px;
  width: 255px;
  background-color: var(--vscode-editorPane-background);
}

section.items table th,
section.items table td {
  border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
  padding: 2px;
}

section.items span.label {
  display: inline-block;
  vertical-align: middle;
  height: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
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
