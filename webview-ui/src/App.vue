<script setup lang="ts">
import type { ModeType } from "./utilities/vscode";
import { ref, onMounted, nextTick, reactive } from "vue";

import MdhPanel from "./components/MdhPanel.vue";
import DiffPanel from "./components/DiffPanel.vue";
import ScanPanel from "./components/ScanPanel.vue";
import VariablesPanel from "./components/VariablesPanel.vue";
import ViewConditionPanel from "./components/ViewConditionPanel.vue";
import WriteToClipboardParamsPanel from "./components/WriteToClipboardParamsPanel.vue";
import ConnectionSettingVue from "./components/ConnectionSetting.vue";
import ResourceProperties from "./components/ResourceProperties.vue";
import ERDiagramSettings from "./components/ERDiagramSettings.vue";
import RecordRuleEditor from "./components/RecordRuleEditor.vue";
import CodeResolverEditor from "./components/CodeResolverEditor.vue";

import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";

const scanPanelRef = ref<InstanceType<typeof ScanPanel>>();

const connectionSettingRef = ref<InstanceType<typeof ConnectionSettingVue>>();
const setConnectionSettingRef = (el: any) => {
  connectionSettingRef.value = el;
};

const mdhPanelRef = ref<InstanceType<typeof MdhPanel>>();
const setMdhPanelRef = (el: any) => {
  mdhPanelRef.value = el;
};

const diffPanelRef = ref<InstanceType<typeof DiffPanel>>();
const setDiffPanelRef = (el: any) => {
  diffPanelRef.value = el;
};

function messageListener(evt: MessageEvent) {
  const { data } = evt;
  const { command, componentName, value } = data;
  console.log("[App.vue] at messageListener ", command, value);
  if (command === "create") {
    // create component
    switch (componentName) {
      case "ConnectionSetting":
        visible.connectionSetting = false;
        visible.resourceProperties = false;
        nextTick(() => {
          mode.value = value.mode;
          settingItem.value = value.setting;
          prohibitedNames.value.splice(0, prohibitedNames.value.length, ...value.prohibitedNames);
          visible.connectionSetting = true;
        });
        break;
      case "ResourceProperties":
        visible.connectionSetting = false;
        visible.resourceProperties = false;
        nextTick(() => {
          resourcePropertiesValues.value = value;
          visible.resourceProperties = true;
        });
        break;
      case "MdhPanel":
        visible.mdhPanel = true;
        break;
      case "DiffPanel":
        visible.diffPanel = true;
        break;
      case "ScanPanel":
        scanValues.value = value;
        visible.scanPanel = true;
        break;
      case "VariablesPanel":
        values.value = value;
        visible.variablePanel = false;
        nextTick(() => {
          visible.variablePanel = true;
        });
        break;
      case "ViewConditionPanel":
        values.value = value;
        visible.viewConditionPanel = false;
        nextTick(() => {
          visible.viewConditionPanel = true;
        });
        break;
      case "WriteToClipboardParamsPanel":
        values.value = value;
        visible.writeToClipboardParamsPanel = false;
        nextTick(() => {
          visible.writeToClipboardParamsPanel = true;
        });
        break;
      case "ERDiagramSettingsPanel":
        values.value = value;
        visible.eRDiagramSettingsPanel = false;
        nextTick(() => {
          visible.eRDiagramSettingsPanel = true;
        });
        break;
      case "RecordRuleEditor":
        values.value = value;
        visible.recordRuleEditor = false;
        nextTick(() => {
          visible.recordRuleEditor = true;
        });
        break;
      case "CodeResolverEditor":
        values.value = value;
        visible.codeResolverEditor = false;
        nextTick(() => {
          visible.codeResolverEditor = true;
        });
        break;
    }
    return;
  }
  switch (command) {
    case "ConnectionSetting-stop-progress":
      {
        connectionSettingRef.value?.stopProgress();
      }
      break;
    case "ScanPanel-add-tab-item":
      scanPanelRef.value?.addTabItem(value);
      break;
    case "ScanPanel-remove-tab-item":
      scanPanelRef.value?.removeTabItem(value.tabId);
      break;
    case "ScanPanel-set-search-result":
      scanPanelRef.value?.setSearchResult(value);
      break;
    case "MdhPanel-add-tab-item":
      mdhPanelRef.value?.addTabItem(value);
      break;
    case "MdhPanel-set-search-result":
      mdhPanelRef.value?.setSearchResult(value);
      break;
    case "DiffPanel-add-tab-item":
      diffPanelRef.value?.addTabItem(value);
      break;
    case "DiffPanel-set-search-result":
      diffPanelRef.value?.setSearchResult(value);
      break;
  }
}

onMounted(() => {
  window.removeEventListener("message", messageListener);
  window.addEventListener("message", messageListener);
});

const visible = reactive<{
  nowLoading: boolean;
  connectionSetting: boolean;
  resourceProperties: boolean;
  mdhPanel: boolean;
  scanPanel: boolean;
  diffPanel: boolean;
  variablePanel: boolean;
  viewConditionPanel: boolean;
  writeToClipboardParamsPanel: boolean;
  eRDiagramSettingsPanel: boolean;
  recordRuleEditor: boolean;
  codeResolverEditor: boolean;
}>({
  nowLoading: false,
  connectionSetting: false,
  resourceProperties: false,
  mdhPanel: false,
  scanPanel: false,
  diffPanel: false,
  variablePanel: false,
  viewConditionPanel: false,
  writeToClipboardParamsPanel: false,
  eRDiagramSettingsPanel: false,
  recordRuleEditor: false,
  codeResolverEditor: false,
});

const mode = ref<ModeType>("create");
const prohibitedNames = ref<string[]>([]);
const settingItem = ref<ConnectionSetting | undefined>(undefined);
const values = ref<any>();
const scanValues = ref<any>();
const resourcePropertiesValues = ref<{ [key: string]: string }>({});
</script>

<template>
  <main>
    <div v-if="visible.nowLoading" class="loading-container">
      <span class="codicon codicon-loading codicon-modifier-spin" style="margin-right: 4px"></span
      >Loading...
    </div>
    <ConnectionSettingVue
      v-if="visible.connectionSetting"
      :ref="setConnectionSettingRef"
      :mode="mode"
      :item="settingItem"
      :prohibitedNames="prohibitedNames"
    ></ConnectionSettingVue>
    <ResourceProperties
      v-if="visible.resourceProperties"
      :values="resourcePropertiesValues"
    ></ResourceProperties>
    <MdhPanel v-if="visible.mdhPanel" :ref="setMdhPanelRef"></MdhPanel>
    <DiffPanel v-if="visible.diffPanel" :ref="setDiffPanelRef"></DiffPanel>
    <ScanPanel ref="scanPanelRef" v-show="visible.scanPanel" :opt="scanValues"></ScanPanel>
    <VariablesPanel v-if="visible.variablePanel" :rdh="values" />
    <ViewConditionPanel
      v-if="visible.viewConditionPanel"
      :tableRes="values.tableRes"
      :numOfRows="values.numOfRows"
      :limit="values.limit"
    />
    <WriteToClipboardParamsPanel v-if="visible.writeToClipboardParamsPanel" :params="values" />
    <ERDiagramSettings
      v-if="visible.eRDiagramSettingsPanel"
      :title="values.title"
      :tables="values.tables"
      :selectedTable="values.selectedTable"
    />
    <RecordRuleEditor
      v-if="visible.recordRuleEditor"
      :connectionSettingNames="values.connectionSettingNames"
      :schema="values.schema"
      :recordRule="values.recordRule"
      :scrollPos="values.scrollPos"
    />
    <CodeResolverEditor
      v-if="visible.codeResolverEditor"
      :connectionSettingNames="values.connectionSettingNames"
      :tableNameList="values.tableNameList"
      :columnNameList="values.columnNameList"
      :resolver="values.resolver"
      :scrollPos="values.scrollPos"
    />
  </main>
</template>

<style>
main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  height: 100vh;
  overflow: hidden;
}

main > * {
  margin: 1px 0;
}

.close-action {
  display: flex;
  width: 26px;
  align-items: center;
  justify-content: center;
}

button[disabled] {
  cursor: not-allowed !important;
}

.splitpanes.default-theme .splitpanes__pane {
  background-color: inherit !important;
}
legend {
  display: flex;
  align-items: center;
}
.verr {
  background-color: var(--vscode-diffEditor-removedTextBackground) !important;
}
fieldset.no-elements {
  border-color: var(--vscode-diffEditor-removedTextBackground) !important;
  background-color: var(--vscode-diffEditor-removedTextBackground) !important;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  width: 100%;
}

.toolbar {
  padding: 3px 4px;
  margin-bottom: 11px;
  display: flex;
}
div.tool-left,
div.tool-right {
  display: flex;
  column-gap: 3px;
  align-items: center;
}
.tool-left {
  flex-grow: 1;
}
</style>
