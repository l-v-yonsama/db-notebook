<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  CreateInsertScriptSettingsPanelEventData,
  CreateScriptConditionParams,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { nextTick, onMounted, ref } from "vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";

const sectionHeight = ref(300);
const sectionWidth = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector(".script-creation-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 75, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = Math.max(sectionWrapper.clientWidth - 14, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const numOfRecordsItems = ref([] as DropdownItem[]);

for (let i of [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000]) {
  numOfRecordsItems.value.push({
    label: `${i}`,
    value: i,
  });
}

const previewSql = ref("");

const assignSchemaName = ref(true);
const onlyNotNullColumns = ref(false);
const withComments = ref(false);
const compactSql = ref(false);
const tableNameWithComment = ref("");
const langType = ref("sql" as "sql" | "javascript");
const numOfRecords = ref(1);

const langItems: DropdownItem[] = [
  {
    label: "SQL",
    value: "sql",
  },
  {
    label: "Javascript",
    value: "javascript",
  },
];

const initialize = (v: CreateInsertScriptSettingsPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }

  assignSchemaName.value = v.assignSchemaName === true;
  onlyNotNullColumns.value = v.onlyNotNullColumns === true;
  withComments.value = v.withComments === true;
  compactSql.value = v.compactSql === true;
  langType.value = v.langType;
  numOfRecords.value = v.numOfRecords;

  previewSql.value = v.previewSql;
  if (v.tableRes.comment) {
    tableNameWithComment.value = `${v.tableRes.name} (${v.tableRes.comment})`;
  } else {
    tableNameWithComment.value = v.tableRes.name;
  }
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};
const handleNumOfRecordsOnChange = () => {
  ok(false, true);
};
const handleLnagTypeOnChange = (newVal: "javascript" | "sql") => {
  langType.value = newVal;
  ok(false, true);
};
const ok = (openInNotebook: boolean, preview: boolean) => {
  const params: CreateScriptConditionParams = {
    assignSchemaName: assignSchemaName.value,
    onlyNotNullColumns: onlyNotNullColumns.value,
    withComments: withComments.value,
    compactSql: compactSql.value,
    lang: langType.value,
    numOfRecords: numOfRecords.value,
    preview,
    openInNotebook,
  };
  vscode.postCommand({
    command: "ok",
    params,
  });
};

const setPreviewSql = (sql: string): void => {
  previewSql.value = sql;
};

const recieveMessage = (data: CreateInsertScriptSettingsPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
    case "set-preview-sql":
      if (value.setPreviewSql === undefined) {
        return;
      }
      setPreviewSql(value.setPreviewSql.previewSql);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="script-creation-root">
    <PanelActionToolbar @cancel="cancel">
      <template #left>
        <label v-if="langType === 'sql'" for="tableName">Table:</label>
        <span v-if="langType === 'sql'" id="tableName">{{ tableNameWithComment }}</span>
        <label for="langType">Lang:</label>
        <VsCodeRadioGroupVue id="langType" v-model="langType" :items="langItems"
          @change="($e: any) => handleLnagTypeOnChange($e.target?.value)" />
        <label v-if="langType === 'javascript'" for="numOfRecords"> Num of records </label>
        <VsCodeDropdown v-if="langType === 'javascript'" id="numOfRecords" v-model="numOfRecords"
          :items="numOfRecordsItems" style="z-index: 15" @change="handleNumOfRecordsOnChange()" />
      </template>
      <VsCodeButton @click="ok(true, false)" appearance="secondary" title="Open in notebook"
        style="margin-right: 5px">
        <fa icon="book" />Open in notebook
      </VsCodeButton>
      <VsCodeButton @click="ok(false, false)" title="Copy to clipboard">
        <fa icon="clipboard" />Copy to clipboard
      </VsCodeButton>
    </PanelActionToolbar>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="settings">
        <div class="editor">
          <fieldset class="conditions">
            <legend>
              <span style="margin-right: 30px">Conditions</span>
            </legend>
            <VsCodeCheckbox v-model="assignSchemaName" @change="ok(false, true)"
              style="margin-right: auto">With
              schema name</VsCodeCheckbox>
            <VsCodeCheckbox v-model="withComments" @change="ok(false, true)"
              style="margin-right: auto">With
              comments</VsCodeCheckbox>
            <VsCodeCheckbox v-model="onlyNotNullColumns" @change="ok(false, true)"
              style="margin-right: auto">Only
              "NOT NULL" Columns</VsCodeCheckbox>
            <VsCodeCheckbox :disabled="langType === 'javascript'" v-model="compactSql" @change="ok(false, true)"
              style="margin-right: auto">Compact
              SQL</VsCodeCheckbox>
          </fieldset>
        </div>
        <fieldset class="conditions">
          <legend>Preview</legend>
          <p class="preview" v-text="previewSql"></p>
        </fieldset>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
section.script-creation-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  & .toolbar {
    margin: 5px;
    margin-bottom: 0px !important;

    .tool-left {
      label {
        margin-left: 25px;
        margin-right: 5px;
      }

      span {
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
        max-width: 280px;
      }
    }
  }

  .scroll-wrapper {
    margin: 5px;
    overflow: auto;

    fieldset.conditions {
      margin-top: 15px;
    }

    p.preview {
      margin: 5px;
      white-space: pre-wrap;
    }
  }
}
</style>
