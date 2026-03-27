<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type { LogParseSettingPanelEventData, SaveLogOptionParams } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import VsCodeDropdown from "../base/VsCodeDropdown.vue";

import {
  provideVSCodeDesignSystem, vsCodeCheckbox, vsCodePanels,
  vsCodePanelTab,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";

import type { InitializePayload, ResetConfigFileAndItemsPayload, ResetConfigPayload } from "./LogParseSettingPanel.types";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab(), vsCodeCheckbox());

/* state */

const sectionHeight = ref(300);
const sectionRdhHeight = ref(300);
const sectionWidth = ref(300);

const configEditorVisible = ref(false);
const sqlParsePresetVisible = ref(false);
const configFile = ref('');
const linesToParse = ref('-1');
const configFileItems = ref([] as DropdownItem[]);
const lineItems = ref([] as DropdownItem[]);

const formatterSqlLanguage = ref('' as (InitializePayload["formatterSqlLanguage"] | ''));
const formatterSqlLanguageItems = ref([] as DropdownItem[]);

const initilizing = ref(true);
const editingLogFieldsPattern = ref(false);
const editingEventClassification = ref(false);
const sqlExtractionFlowEditable = ref(false);
const processing = ref(false);

const errorMessage = ref('');
const totalLogLines = ref(0);
const canSplitLog = ref(false);

const currentLogFieldPattern = ref('');
const currentEventClassification = ref('');
const currentSqlExtractionFlow = ref('');

// Preset
const logSplitDetectionMessage = ref('');
const splitPresetItems = ref([] as DropdownItem[]);
const splitPresetName = ref('');

const sqlParseDetectionMessage = ref('');
const sqlParsePresetItems = ref([] as DropdownItem[]);
const sqlParsePresetName = ref('');

/* lifecycle */

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector(".log-conditional-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 68, 100);
    sectionRdhHeight.value = Math.max(sectionHeight.value - 165, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = sectionWrapper.clientWidth - 50;
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

/* computed */
const isSummaryVisible = computed((): boolean => {
  return currentLogFieldPattern.value.length > 1 || !!currentEventClassification.value || !!currentSqlExtractionFlow.value;
});
const isConfigFileSelected = computed((): boolean => {
  return !!configFile.value;
});

const computedPresetInfo = computed((): {
  logExample: string;
  logFieldsPattern: string;
} => {
  const presetName = splitPresetName.value;
  if (presetName) {
    const item = splitPresetItems.value.find(it => it.value === presetName)
    if (item) {
      return {
        logExample: item.meta?.logExample ?? '',
        logFieldsPattern: item.meta?.logFieldsPattern ?? '',

      }
    }
  }
  return {
    logExample: '',
    logFieldsPattern: '',
  };
});

const initialize = async (v: InitializePayload) => {
  initilizing.value = true;
  editingLogFieldsPattern.value = false;
  editingEventClassification.value = false;
  sqlExtractionFlowEditable.value = false;
  configFileItems.value.splice(0, configFileItems.value.length);
  lineItems.value.splice(0, lineItems.value.length);
  totalLogLines.value = v.totalLogLines;
  configFile.value = '';
  sqlParsePresetVisible.value = false;
  errorMessage.value = v.errorMessage;

  if (v.totalLogLines < 50) {
    lineItems.value.push({ label: `${v.totalLogLines}`, value: `${v.totalLogLines}` });
  } else {
    for (const i of [50, 100, 200, 500, 1000]) {
      if (i <= v.totalLogLines) {
        lineItems.value.push({ label: `${i}`, value: `${i}` });
      }
    }
  }
  lineItems.value.push({ label: 'All', value: '-1' });

  formatterSqlLanguageItems.value.splice(0, formatterSqlLanguageItems.value.length);

  // preset
  splitPresetItems.value.splice(0, splitPresetItems.value.length);
  sqlParsePresetItems.value.splice(0, sqlParsePresetItems.value.length);

  await nextTick();

  linesToParse.value = v.linesToParse.toString();

  formatterSqlLanguageItems.value.push({ label: '-- Select --', value: '' });
  v.formatterSqlLanguageItems.forEach(it => {
    formatterSqlLanguageItems.value.push(it);
  });
  formatterSqlLanguage.value = v.formatterSqlLanguage ?? '';

  // preset
  logSplitDetectionMessage.value = v.preset.logSplitDetectionMessage;
  splitPresetItems.value.push({ label: '-- Select --', value: '' });
  v.preset.logEventSplitPresets.forEach(it => {
    splitPresetItems.value.push({
      label: it.label, value: it.name, meta: {
        logExample: it.logExample,
        logFieldsPattern: it.logFieldsPattern,
      }
    });
  });
  sqlParseDetectionMessage.value = v.preset.sqlParseDetectionMessage;
  sqlParsePresetItems.value.push({ label: '-- Select --', value: '' });
  v.preset.sqlParsePresets.forEach(it => {
    sqlParsePresetItems.value.push({
      label: it.label, value: it.value
    });
  });

  // config
  configFileItems.value.push({ label: '-- Select --', value: '' });
  v.logParserConfigItems.forEach(it => configFileItems.value.push(it));
  configFile.value = v.logParserConfigFile;

  currentLogFieldPattern.value = v.configSummary.logEventSplitPattern;
  currentEventClassification.value = v.configSummary.classificationSummary;
  currentSqlExtractionFlow.value = v.configSummary.extractionSummary;
  initilizing.value = false;
};

/* handlers */

const resetConfig = async (v: ResetConfigPayload) => {
  currentLogFieldPattern.value = v.configSummary.logEventSplitPattern;
  currentEventClassification.value = v.configSummary.classificationSummary;
  currentSqlExtractionFlow.value = v.configSummary.extractionSummary;
  canSplitLog.value = v.canSplitLog;
  errorMessage.value = v.errorMessage;
  // preset
  splitPresetItems.value.splice(0, splitPresetItems.value.length);
  sqlParsePresetItems.value.splice(0, sqlParsePresetItems.value.length);
  await nextTick();

  // preset
  logSplitDetectionMessage.value = v.preset.logSplitDetectionMessage;
  splitPresetItems.value.push({ label: '-- Select --', value: '' });
  v.preset.logEventSplitPresets.forEach(it => {
    splitPresetItems.value.push({
      label: it.label, value: it.name, meta: {
        logExample: it.logExample,
        logFieldsPattern: it.logFieldsPattern,
      }
    });
  });
  sqlParseDetectionMessage.value = v.preset.sqlParseDetectionMessage;
  sqlParsePresetItems.value.push({ label: '-- Select --', value: '' });
  v.preset.sqlParsePresets.forEach(it => {
    sqlParsePresetItems.value.push({
      label: it.label, value: it.value
    });
  });
};

const resetConfigFileAndItems = async (v: ResetConfigFileAndItemsPayload) => {
  initilizing.value = true;
  configFileItems.value.splice(0, configFileItems.value.length);
  configFile.value = '';

  await nextTick();

  // config
  configFileItems.value.push({ label: '-- Select --', value: '' });
  v.logParserConfigItems.forEach(it => configFileItems.value.push(it));
  configFile.value = v.logParserConfigFile;
  initilizing.value = false;
};

const setConfigEditorVisibility = async (v: boolean) => {
  configEditorVisible.value = v;
};

const setSqlParsePresetVisibility = async (v: boolean) => {
  sqlParsePresetVisible.value = v;
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const resetLines = () => {
  postOk({ action: 'reset-lines', linesToParse: Number(linesToParse.value) });
  splitPresetName.value = '';
};

const resetSqlLanguage = () => {
  const sqlLanguage = formatterSqlLanguage.value === '' ? undefined : formatterSqlLanguage.value;
  postOk({ action: 'reset-formatter-sql-language', sqlLanguage });
  splitPresetName.value = '';
};

const applyLogEventSplitPreset = () => {
  postOk({ action: 'apply-log-event-split-preset', presetName: splitPresetName.value });
  splitPresetName.value = '';
};

const applySqlParsePreset = () => {
  postOk({ action: 'apply-parser-sql-preset', presetName: sqlParsePresetName.value });
  sqlParsePresetName.value = '';
};

const openAsJSON = () => {
  postOk({ action: 'open-as-json', presetName: splitPresetName.value });
  splitPresetName.value = '';
};

const postOk = async ({ action, presetName, linesToParse, sqlLanguage }: {
  action: SaveLogOptionParams['action'],
  presetName?: string;
  linesToParse?: number;
  sqlLanguage?: InitializePayload["formatterSqlLanguage"];
}) => {
  processing.value = true;
  const params: SaveLogOptionParams = {
    action,
    presetName,
    linesToParse,
    sqlLanguage,
    logParserConfigFile: configFile.value
  }

  vscode.postCommand({ command: "ok", params });

};


const recieveMessage = (data: LogParseSettingPanelEventData) => {
  processing.value = false;
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
    case "reset-config":
      if (value['reset-config'] === undefined) {
        return;
      }
      resetConfig(value['reset-config']);
      break;
    case "reset-config-file-and-items":
      if (value['reset-config-file-and-items'] === undefined) {
        return;
      }
      resetConfigFileAndItems(value['reset-config-file-and-items']);
      break;
    case "set-config-editor-visibility":
      if (value['set-config-editor-visibility'] === undefined) {
        return;
      }
      setConfigEditorVisibility(value['set-config-editor-visibility']);
      break;
    case "set-sql-parse-preset-visibility":
      if (value['set-sql-parse-preset-visibility'] === undefined) {
        return;
      }
      setSqlParsePresetVisibility(value['set-sql-parse-preset-visibility']);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="log-conditional-root">
    <div class="toolbar">
      <div class="tool-left">
        <span v-if="errorMessage" class="disabled-reason">⚠️ {{ errorMessage }}</span>
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel" style="margin-right: 5px">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton @click="postOk({ 'action': 'create-new-config' })" title="Create new config"
          :appearance="isConfigFileSelected ? 'secondary' : ''">
          <fa icon="plus" />{{ configEditorVisible ? 'Create config' : 'Create new config' }}
        </VsCodeButton>
        <VsCodeButton @click="openAsJSON" title="Create new config" :disabled="configEditorVisible || configFile === ''"
          :appearance="isConfigFileSelected ? '' : 'secondary'">
          <fa icon="pencil" />Edit config
        </VsCodeButton>
        <VsCodeButton @click="postOk({ 'action': 'test-split' })" title="Test split log" appearance="secondary"
          :disabled="!canSplitLog">
          <fa icon="check" />Test split log
        </VsCodeButton>
        <VsCodeButton @click="postOk({ 'action': 'parse' })" title="Parse log" :disabled="!!errorMessage">
          <fa icon="check" />Parse log
        </VsCodeButton>
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="editor">
        <fieldset class="conditions">
          <legend>
            <span style="margin-right: 30px">Log parser conditions</span>
          </legend>

          <div v-if="!initilizing" class="area">
            <section class="condition-grid">
              <div class="flex-line">
                <label for="splitPreset" class="condition-label">Lines to parse:&nbsp;</label>
                <div>
                  <VsCodeDropdown id="splitPreset" v-model="linesToParse" :items="lineItems" style="z-index: 30;"
                    @change="resetLines" />
                  <p class="total-log-lines hint" style="margin-left: 2px;">(Total log lines: {{totalLogLines}} )</p>
                </div>
              </div>
              <div class="flex-line">
                <label for="configFile" class="condition-label">Config file:&nbsp;</label>
                <VsCodeDropdown id="configFile" v-model="configFile" :items="configFileItems"
                  style="z-index: 100; width: 300px;" @change="postOk({ 'action': 'set-config-file' })" />
              </div>
              <div class="flex-line">
                <label for="formatterSqlLanguage" class="condition-label">Formatter SQL language:&nbsp;</label>
                <div>
                  <VsCodeDropdown id="formatterSqlLanguage" v-model="formatterSqlLanguage"
                    :items="formatterSqlLanguageItems" style="z-index: 25;" @change="resetSqlLanguage" />
                  <p class="log-detection-message hint" style="margin-left: 2px;">( optional )</p>
                </div>
              </div>
              <div class="flex-line">&nbsp;</div>

              <template v-if="isConfigFileSelected">
                <div>
                  <div class="flex-line">
                    <label for="splitPreset" class="condition-label">Log split preset:&nbsp;</label>
                    <VsCodeDropdown id="splitPreset" v-model="splitPresetName" :items="splitPresetItems"
                      style="z-index: 15; width: 200px;" />
                    <VsCodeButton @click="applyLogEventSplitPreset" :disabled="splitPresetName === ''"
                      title="Apply selected preset" appearance="secondary">
                      <fa icon="check" />Apply
                    </VsCodeButton>
                  </div>
                  <p v-if="logSplitDetectionMessage" class="log-detection-message hint">( {{
                    logSplitDetectionMessage }} )</p>
                </div>
                <div>
                  <div class="flex-line">
                    <label for="sqlParsePreset" class="condition-label">Classify & Extract preset:&nbsp;</label>
                    <template v-if="sqlParsePresetVisible">
                      <VsCodeDropdown id="sqlParsePreset" v-model="sqlParsePresetName" :items="sqlParsePresetItems"
                        style="z-index: 15; width: 200px;" />
                      <VsCodeButton @click="applySqlParsePreset" :disabled="sqlParsePresetName === ''"
                        title="Apply selected preset" appearance="secondary">
                        <fa icon="check" />Apply
                      </VsCodeButton>
                    </template>
                    <p v-else style="margin:0"><span class="disabled-reason">⚠️ Log must be split before using this feature.</span></p>
                  </div>
                  <p v-if="sqlParsePresetVisible && sqlParseDetectionMessage" class="log-detection-message hint">( {{
                    sqlParseDetectionMessage }} )</p>
                </div>
              </template>
            </section>
            <template v-if="isConfigFileSelected">

              <fieldset v-if="splitPresetName" class="preset-details">
                <legend class="legend-bar">
                  <span>Preset details <VsCodeButton @click="splitPresetName = ''" appearance="secondary"
                      style="margin-left:10px;">
                      Close</VsCodeButton></span>
                </legend>
                <fieldset v-if="computedPresetInfo.logExample" class="example-logs">
                  <legend>
                    <span>Target log examples</span>
                  </legend>
                  <div class="log-examples" v-text="computedPresetInfo.logExample"></div>
                </fieldset>
                <fieldset v-if="computedPresetInfo.logFieldsPattern" class="log-fields-pattern">
                  <legend>
                    <span>Log fields pattern</span>
                  </legend>
                  <div class="log-fields-pattern" v-text="computedPresetInfo.logFieldsPattern"></div>
                </fieldset>
              </fieldset>

              <fieldset v-if="isSummaryVisible" class="summary">
                <legend><span>Summary</span></legend>

                <label for="currentLogFieldPattern" class="condition-label">Log fields pattern</label>
                <div id="currentLogFieldPattern" class="log-fields-pattern" v-text="currentLogFieldPattern"></div>

                <template v-if="currentEventClassification">
                  <label for="currentEventClassification" class="condition-label">Event classification</label>
                  <div id="currentEventClassification" class="event-classification" v-text="currentEventClassification">
                  </div>
                </template>

                <template v-if="currentSqlExtractionFlow" class="sql-extraction-flow">
                  <label for="currentSqlExtractionFlow" class="condition-label">SQL extraction flow</label>
                  <div id="currentSqlExtractionFlow" class="sql-extraction-flow" v-text="currentSqlExtractionFlow">
                  </div>
                </template>
              </fieldset>
            </template>
          </div>
        </fieldset>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
/* ===============================
   Root Layout
================================ */

.log-conditional-root {
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;

  >div {
    margin: 5px;
  }
}

fieldset {
  margin-top: 8px;
}

/* ===============================
   Toolbar
================================ */

.toolbar {
  margin-bottom: 0 !important;

  .tool-left {

    label {
      margin-left: 25px;
      margin-right: 5px;
    }

    span {
      max-width: 280px;

      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

/* ===============================
   Scroll Area
================================ */

.scroll-wrapper {
  overflow: auto;
}

.condition-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;

  div.flex-line {
    display: flex;
    column-gap: 3px;
  }
}

/* ===============================
   Conditions Panel
================================ */

.conditions {

  margin-top: 0;

  legend span {
    margin-left: 8px;
    margin-right: 30px;
  }

  label,
  span {
    display: inline-block;
    margin-top: 5px;
  }

  label.condition-label {
    min-width: 156px;
  }
}

/* ===============================
   Preset Details
================================ */

.preset-details {

  margin-bottom: 15px;

  .log-fields-pattern,
  .event-classification,
  .sql-extraction-flow {
    opacity: 0.7;
  }
}



/* ===============================
   Log Examples
================================ */

.log-examples {
  max-height: 85px;

  overflow: auto;
  white-space: pre;
}

/* ===============================
   Pattern Display
================================ */

fieldset.summary {
  div {
    white-space: pre-wrap;
    margin-left: 1em;
    opacity: 0.7;
    max-height: 4.5em;
    overflow-y: auto;
  }
}

/* ===============================
   Utility
================================ */

.hint {
  opacity: 0.7;
  margin: 1px 0 6px 158px;
  font-size: x-small;
}

/* ===============================
   Preview
================================ */

.preview {
  margin-top: 15px;
}
</style>
