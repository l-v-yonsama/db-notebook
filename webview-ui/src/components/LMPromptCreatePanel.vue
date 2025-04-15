<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  LMPromptCreateConditionParams,
  LMPromptCreatePanelEventData,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

const sectionHeight = ref(300);
const sectionWidth = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector(".lm-prompt-creation-root");
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

const languageModelItems: DropdownItem[] = [];

const assistantPromptText = ref("");
const userPromptText = ref("");

const hasExplainPlan = ref(false);
const translateResponse = ref(true);
const withTableDefinition = ref(false);
const withRetrievedExecutionPlan = ref(false);
const languageModelId = ref("");
const errorMessage = ref("");

const initialize = (v: LMPromptCreatePanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }

  languageModelItems.splice(0, languageModelItems.length);
  for (let lm of v.languageModels) {
    languageModelItems.push({
      label: lm.label,
      value: lm.value,
    });
  }

  errorMessage.value = v.errorMessage;
  hasExplainPlan.value = v.hasExplainPlan === true;
  translateResponse.value = v.translateResponse === true;
  withTableDefinition.value = v.withTableDefinition === true;
  withRetrievedExecutionPlan.value = v.withRetrievedExecutionPlan === true;
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
const handleWithRetrievedExecutionPlanOnChange = (newVal: boolean) => {
  withRetrievedExecutionPlan.value = newVal;

  ok(true);
};

const ok = (preview: boolean) => {
  const params: LMPromptCreateConditionParams = {
    translateResponse: translateResponse.value,
    withTableDefinition: withTableDefinition.value,
    withRetrievedExecutionPlan: withRetrievedExecutionPlan.value,
    languageModelId: languageModelId.value,
    preview,
  };
  vscode.postCommand({
    command: "ok",
    params,
  });
};

const setPrompts = (v: { assistantPromptText: string, userPromptText: string }): void => {
  assistantPromptText.value = v.assistantPromptText;
  userPromptText.value = v.userPromptText;
};

const recieveMessage = (data: LMPromptCreatePanelEventData) => {
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
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="lm-prompt-creation-root">
    <div class="toolbar">
      <div class="tool-left">
        <label for="languageModelId"> Language model</label>
        <VsCodeDropdown id="languageModelId" v-model="languageModelId" :items="languageModelItems"
          style="z-index: 15; width: 220px;" @change="handleLanguageModelOnChange()" />
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel" style="margin-right: 5px">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton :disabled="errorMessage.length > 0" @click="ok(false)" title="Evaluate the sql">
          <fa icon="check" />Evaluate sql
        </VsCodeButton>
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div v-if="errorMessage">
        <p>{{ errorMessage }}</p>
      </div>
      <template v-else>
        <div class="settings">
          <div class="editor">
            <fieldset class="conditions">
              <legend>
                <span style="margin-right: 30px">Conditions</span>
              </legend>
              <vscode-checkbox :checked="translateResponse"
                @change="($e: any) => handleTranslateResponseOnChange($e.target.checked)"
                style="margin-right: auto">Translate response</vscode-checkbox>
              <vscode-checkbox :checked="withTableDefinition"
                @change="($e: any) => handleWithTableDefinitionOnChange($e.target.checked)"
                style="margin-right: auto">Provide
                table definitions</vscode-checkbox>
              <vscode-checkbox :checked="withRetrievedExecutionPlan" :disabled="!hasExplainPlan"
                @change="($e: any) => handleWithRetrievedExecutionPlanOnChange($e.target.checked)"
                style="margin-right: auto">Include retrieved "Execution Plan" *</vscode-checkbox>
              <p v-if="!hasExplainPlan" style="margin-left: 8px; font-size: small; opacity: 0.7;">* Get an “Explain
                plan”
                in advance</p>
            </fieldset>
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
      </template>
    </div>
  </section>
</template>

<style lang="scss" scoped>
section.lm-prompt-creation-root {
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
