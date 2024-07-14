<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  CreateInsertScriptSettingsPanelEventData,
  CreateScriptConditionParams,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

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
const handleAssignSchemaNameOnChange = (newVal: boolean) => {
  assignSchemaName.value = newVal;

  ok(false, true);
};
const handleOnlyNotNullColumnsOnChange = (newVal: boolean) => {
  onlyNotNullColumns.value = newVal;

  ok(false, true);
};
const handleWithCommentsOnChange = (newVal: boolean) => {
  withComments.value = newVal;

  ok(false, true);
};
const handleCompactSqlOnChange = (newVal: boolean) => {
  compactSql.value = newVal;

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
    <div class="toolbar">
      <div class="tool-left">
        <label v-if="langType === 'sql'" for="tableName">Table:</label>
        <span v-if="langType === 'sql'" id="tableName">{{ tableNameWithComment }}</span>
        <label for="langType">Lang:</label>
        <VsCodeRadioGroupVue
          id="langType"
          v-model="langType"
          :items="langItems"
          @change="($e:any) => handleLnagTypeOnChange($e.target?.value)"
        />
        <label v-if="langType === 'javascript'" for="numOfRecords"> Num of records </label>
        <VsCodeDropdown
          v-if="langType === 'javascript'"
          id="numOfRecords"
          v-model="numOfRecords"
          :items="numOfRecordsItems"
          style="z-index: 15"
          @change="handleNumOfRecordsOnChange()"
        />
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
          @click="ok(true, false)"
          appearance="secondary"
          title="Open in notebook"
          style="margin-right: 5px"
          ><fa icon="book" />Open in notebook</VsCodeButton
        >
        <VsCodeButton @click="ok(false, false)" title="Write to clipboard"
          ><fa icon="clipboard" />Write to clipboard</VsCodeButton
        >
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="settings">
        <div class="editor">
          <fieldset class="conditions">
            <legend>
              <span style="margin-right: 30px">Conditions</span>
            </legend>
            <vscode-checkbox
              :checked="assignSchemaName"
              @change="($e:any) => handleAssignSchemaNameOnChange($e.target.checked)"
              style="margin-right: auto"
              >With schema name</vscode-checkbox
            >
            <vscode-checkbox
              :checked="withComments"
              @change="($e:any) => handleWithCommentsOnChange($e.target.checked)"
              style="margin-right: auto"
              >With comments</vscode-checkbox
            >
            <vscode-checkbox
              :checked="onlyNotNullColumns"
              @change="($e:any) => handleOnlyNotNullColumnsOnChange($e.target.checked)"
              style="margin-right: auto"
              >Only "NOT NULL" Columns</vscode-checkbox
            >
            <vscode-checkbox
              :disabled="langType === 'javascript'"
              :checked="compactSql"
              @change="($e:any) => handleCompactSqlOnChange($e.target.checked)"
              style="margin-right: auto"
              >Compact SQL</vscode-checkbox
            >
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
