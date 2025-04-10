<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  Chat2QueryConditionParams,
  Chat2QueryPanelEventData,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { DbTable, ForeignKeyConstraintDetail } from "@l-v-yonsama/multi-platform-database-drivers";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";
import VsCodeTextArea from "./base/VsCodeTextArea.vue";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

type TableItem = {
  name: string;
  comment: string;
  selected: boolean;
  referencedFrom: string[];
  referenceTo: string[];
};

const sectionHeight = ref(300);
const sectionWidth = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector(".chat-2-query-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 58, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = Math.max(sectionWrapper.clientWidth - 14, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});


function getReferenceTableNames(references?: {
  [columnName: string]: ForeignKeyConstraintDetail;
}): string[] {
  if (references) {
    return Object.values(references).map((v) => v.tableName);
  }
  return [];
}
const allTableItems = ref([] as TableItem[]);
let tables: DbTable[] = [];
let selectedTableNames: string[] = [];

const languageModelItems: DropdownItem[] = [];

const assistantPromptText = ref("");
const userPromptText = ref("");
const queryExplanation = ref("");
const queryContent = ref("");
const errorMessage = ref("");

const screenMode = ref("setting" as "setting" | "generating" | "generated");
const elapsedTime = ref("");
const modelName = ref("");
const queryText = ref("");

const translateResponse = ref(true);
const withTableDefinition = ref(false);
const withSampleData = ref(false);
const languageModelId = ref("");
const queryContentExample = ref("");
const queryContentExampleItems: DropdownItem[] = [
  {
    label: '-', value: ''
  }
];

[
  "the 10 best-selling products",
  "the most popular items sold last month",
  "a breakdown of sales by product category",
  "the top 10 customers by total spend",
  "all customers who haven’t made a purchase in the last 6 months",
  "which products have low inventory",
  "about any duplicate customer records",
  "which customers have missing or invalid email addresses",
  "which customers have unrealistic ages, such as under 10 or over 100",
  "if there are any customers who share the same phone number or address",
  "which customers have names containing numbers or special characters",
  "if there are any anomalies in the customer data",
  "which products were sold the most last month",
  "the total quantity sold per product category",
  "the average quantity per order",
  "which products appear most frequently in orders",
  "which orders have missing or zero quantity items",
].forEach((text) => {
  queryContentExampleItems.push({
    label: text,
    value: `Tell me ${text}.`,
  },);
});

const commentTypeItems: DropdownItem[] = [
  {
    label: "none(just the SQL)",
    value: "none",
  },
  {
    label: "before the SQL",
    value: "before",
  },
  {
    label: "with inline",
    value: "inline",
  }
];
const commentType = ref('before');

const initialize = (v: Chat2QueryPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  tables = v.allTables;
  selectedTableNames = v.selectedTableNames;

  tables.forEach((table) => {
    allTableItems.value.push({
      name: table.name,
      comment: table.comment ?? "",
      selected: selectedTableNames.includes(table.name),
      referencedFrom: getReferenceTableNames(table.foreignKeys?.referencedFrom),
      referenceTo: getReferenceTableNames(table.foreignKeys?.referenceTo),
    });
  });

  languageModelItems.splice(0, languageModelItems.length);
  for (let lm of v.languageModels) {
    languageModelItems.push({
      label: lm.label,
      value: lm.value,
    });
  }

  errorMessage.value = v.errorMessage;
  screenMode.value = v.screenMode;
  queryContent.value = v.queryContent;
  translateResponse.value = v.translateResponse === true;
  withTableDefinition.value = v.withTableDefinition === true;
  withSampleData.value = v.withSampleData === true;
  languageModelId.value = v.languageModelId;

  assistantPromptText.value = v.assistantPromptText;
  userPromptText.value = v.userPromptText;
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};
const handleLanguageModelOnChange = () => {
  ok(true);
};
const handleTranslateResponseOnChange = (newVal: boolean) => {
  translateResponse.value = newVal;

  ok(true);
};
const handleWithTableDefinitionOnChange = (newVal: boolean) => {
  withTableDefinition.value = newVal;

  ok(true);
};
const handlewithSampleDataOnChange = (newVal: boolean) => {
  withSampleData.value = newVal;
  ok(true);
};
const handleQueryContentExampleOnChange = () => {
  queryContent.value = queryContentExample.value;
  ok(true);
};
const handleQueryContentOnChange = () => {
  ok(true);
};
const handleCommentTypeOnChange = () => {
  ok(true);
};
const handleSelectedTableNameOnChange = (itemIndex: number, tableName: string, newVal: boolean) => {
  const idx = selectedTableNames.indexOf(tableName);
  if (idx === -1) {
    selectedTableNames.push(tableName);
  } else {
    selectedTableNames.splice(idx, 1);
  }
  allTableItems.value[itemIndex].selected = newVal;
  ok(true);
};

const refinePrompt = () => {
  screenMode.value = "setting";
  errorMessage.value = "";
  queryText.value = "";
  queryExplanation.value = "";
  elapsedTime.value = "";
  modelName.value = "";
  ok(true);
};
const execute = () => {
  vscode.postCommand({ command: "execute", params: {} });
};
const generate = async () => {
  screenMode.value = "generating";
  errorMessage.value = "";
  await nextTick();
  ok(false);
};
const ok = (preview: boolean) => {
  const params: Chat2QueryConditionParams = {
    translateResponse: translateResponse.value,
    withTableDefinition: withTableDefinition.value,
    withSampleData: withSampleData.value,
    queryContent: queryContent.value,
    languageModelId: languageModelId.value,
    preview,
    selectedTableNames,
    commentType: commentType.value as Chat2QueryConditionParams["commentType"],
  };
  vscode.postCommand({
    command: "ok",
    params,
  });
};

const setPrompts = (v: Chat2QueryPanelEventData["value"]["setPrompts"]): void => {
  if (v === undefined) {
    return;
  }
  assistantPromptText.value = v.assistantPromptText;
  userPromptText.value = v.userPromptText;
};

const setResults = (v: Chat2QueryPanelEventData["value"]["setResult"]): void => {
  if (v === undefined) {
    return;
  }
  screenMode.value = v.screenMode;
  elapsedTime.value = v.elapsedTime;
  modelName.value = v.modelName;
  queryText.value = v.queryText;
  queryExplanation.value = v.explanation;
  errorMessage.value = v.errorMessage;
};

const recieveMessage = (data: Chat2QueryPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
    case "set-prompts":
      if (value.setPrompts === undefined) {
        return;
      }
      setPrompts(value.setPrompts);
      break;
    case "set-results":
      if (value.setResult === undefined) {
        return;
      }
      setResults(value.setResult);
      break;
  }
};
const copyToClipboard = () => {
  navigator?.clipboard?.writeText(queryText.value);
};
const abbr = (s: string, len: number) => {
  const slen = s.length;
  if (slen <= len) {
    return s;
  }
  const halfLen = Math.floor(len / 2) - 1;
  return s.substring(0, halfLen) + "..." + s.substring(s.length - halfLen);
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="chat-2-query-root">
    <div class="toolbar">
      <div class="tool-left">
        <label for="languageModelId"> Language model</label>
        <VsCodeDropdown id="languageModelId" v-model="languageModelId" :items="languageModelItems"
          :disabled="screenMode !== 'setting'" style="z-index: 25; width: 220px;"
          @change="handleLanguageModelOnChange()" />
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel" style="margin-right: 5px">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton v-if="screenMode !== 'generated'"
          :disabled="screenMode === 'generating' || queryContent.length === 0 || errorMessage.length > 0"
          @click="generate" title="Generate">
          <fa icon="plus" />Generate
        </VsCodeButton>
        <VsCodeButton v-if="screenMode === 'generated' && errorMessage.length === 0" @click.stop="copyToClipboard()"
          appearance="secondary" class="copy-to-clipboard" title="Copy to clipboard">
          <fa icon="clipboard" />Copy to clipboard
        </VsCodeButton>
        <VsCodeButton v-if="screenMode === 'generated'" appearance="secondary" @click="refinePrompt()"
          title="Refine prompt">
          <fa icon="pencil" />Refine Prompt
        </VsCodeButton>
        <VsCodeButton v-if="screenMode === 'generated' && errorMessage.length === 0" @click="execute()"
          title="Execute query">
          <fa icon="check" />Execute query
        </VsCodeButton>
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div v-if="errorMessage">
        <p>{{ errorMessage }}</p>
      </div>
      <template v-else>
        <div v-if="screenMode === 'setting'" class="settings">
          <div class="editor">
            <div class="field-query-conditions">
              <fieldset class="conditions">
                <legend>
                  <span style="margin-right: 30px">Query Content</span>
                </legend>
                <div style="margin-bottom:10px">
                  <fieldset class="conditions">
                    <legend>
                      <span style="margin-right: 30px">Examples</span>
                    </legend>
                    <VsCodeDropdown id="queryContentExample" v-model="queryContentExample"
                      :items="queryContentExampleItems" style="z-index: 15; width:380px"
                      @change="handleQueryContentExampleOnChange()" />
                  </fieldset>
                </div>

                <VsCodeTextArea id="queryContent" v-model="queryContent" :maxlength="1024" :rows="7"
                  title="Query content" placeholder="Enter query content" @change="handleQueryContentOnChange()"
                  style="height: 97%; width:100%">
                </VsCodeTextArea>
              </fieldset>
            </div>
            <div class="field-conditions">
              <fieldset class="conditions">
                <legend>
                  <span style="margin-right: 30px">Prompt Conditions</span>
                </legend>
                <vscode-checkbox :checked="translateResponse"
                  @change="($e: any) => handleTranslateResponseOnChange($e.target.checked)"
                  style="margin-right: auto">Translate response</vscode-checkbox>
                <vscode-checkbox :checked="withTableDefinition"
                  @change="($e: any) => handleWithTableDefinitionOnChange($e.target.checked)"
                  style="margin-right: auto">Provide
                  table definitions</vscode-checkbox>
                <vscode-checkbox :checked="withSampleData"
                  @change="($e: any) => handlewithSampleDataOnChange($e.target.checked)"
                  style="margin-right: auto">Include
                  Sample data</vscode-checkbox>
                <div>
                  <label for="commentType">Explanation:</label>
                  <VsCodeRadioGroupVue id="commentType" v-model="commentType" :items="commentTypeItems"
                    @change="($e: any) => handleCommentTypeOnChange()"
                    style="display: inline-block; margin-left: 20px;" />
                </div>

                <section v-if="withTableDefinition || withSampleData" class="content"
                  style="height: 159px;overflow-y:auto">
                  <table class="bordered">
                    <thead>
                      <tr>
                        <th>Control</th>
                        <th>Table</th>
                        <th>Comment</th>
                        <th>referenced from</th>
                        <th>reference to</th>
                      </tr>
                    </thead>
                    <tbody>
                      <template v-for="(item, idx) of allTableItems" :key="idx">
                        <tr>
                          <td style="text-align: center;">
                            <vscode-checkbox :checked="item.selected"
                              @change="($e: any) => handleSelectedTableNameOnChange(idx, item.name, $e.target.checked)"
                              style="margin-right: auto"></vscode-checkbox>
                          </td>
                          <td :title="item.name">{{ abbr(item.name, 44) }}</td>
                          <td :title="item.comment">{{ abbr(item.comment, 32) }}</td>
                          <td :title="item.referencedFrom.join(',')">{{ abbr(item.referencedFrom.join(","), 20) }}&nbsp;
                          </td>
                          <td :title="item.referenceTo.join(',')">{{ abbr(item.referenceTo.join(","), 20) }}&nbsp;</td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </section>
              </fieldset>
            </div>
          </div>
          <fieldset class="conditions">
            <legend>AssistantPrompt</legend>
            <p class="preview" v-text="assistantPromptText"></p>
          </fieldset>
          <fieldset class="conditions">
            <legend>UserPrompt</legend>
            <p class="preview" v-text="userPromptText"></p>
          </fieldset>
        </div>
        <div v-else>
          <p>Model: {{ modelName }} &nbsp; ElapsedTime: {{ elapsedTime }}</p>
          <fieldset v-if="queryExplanation && commentType !== 'none'" class="conditions">
            <legend>Explanation</legend>
            <p class="preview" v-text="queryExplanation" style="white-space: pre-wrap;"></p>
          </fieldset>
          <fieldset class="conditions">
            <legend>Generated Query</legend>
            <p class="preview" v-text="queryText" style="white-space: pre-wrap;"></p>
          </fieldset>
        </div>
      </template>
    </div>
  </section>
</template>

<style lang="scss" scoped>
section.chat-2-query-root {
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

  table.bordered {
    border-collapse: collapse;

    th,
    td {
      border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
    }
  }

  .scroll-wrapper {
    margin: 5px;
    overflow: auto;

    div.editor {
      display: flex;
      flex-direction: row;
      width: 100%;
      height: 100%;
    }

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
