<script setup lang="ts">
import "./assets/scss/main.scss";
import type { ComponentName, MessageEventData } from "./utilities/vscode";
import { ref, onMounted } from "vue";

import MdhPanel from "./components/MdhPanel.vue";
import HttpResponsesPanel from "./components/HttpResponsesPanel.vue";
import DBFormView from "./components/DBFormView.vue";
import DiffPanel from "./components/DiffPanel.vue";
import ScanPanel from "./components/ScanPanel.vue";
import VariablesPanel from "./components/VariablesPanel.vue";
import ViewConditionPanel from "./components/ViewConditionPanel.vue";
import WriteToClipboardParamsPanel from "./components/WriteToClipboardParamsPanel.vue";
import NotebookCellMetadataPanel from "./components/NotebookCellMetadataPanel.vue";

import ERDiagramSettings from "./components/ERDiagramSettings.vue";
import RecordRuleEditor from "./components/RecordRuleEditor.vue";
import CodeResolverEditor from "./components/CodeResolverEditor.vue";
import type ERDiagramSettingsVue from "./components/ERDiagramSettings.vue";

const dBFormViewRef = ref<InstanceType<typeof DBFormView>>();
const mdhPanelRef = ref<InstanceType<typeof MdhPanel>>();
const httpResponsesPanelRef = ref<InstanceType<typeof HttpResponsesPanel>>();
const diffPanelRef = ref<InstanceType<typeof DiffPanel>>();
const scanPanelRef = ref<InstanceType<typeof ScanPanel>>();
const viewConditionPanelRef = ref<InstanceType<typeof ViewConditionPanel>>();
const variablesPanelRef = ref<InstanceType<typeof VariablesPanel>>();
const writeToClipboardParamsPanelRef = ref<InstanceType<typeof WriteToClipboardParamsPanel>>();
const notebookCellMetadataPanelRef = ref<InstanceType<typeof NotebookCellMetadataPanel>>();
const eRDiagramSettingsPanelRef = ref<InstanceType<typeof ERDiagramSettingsVue>>();
const recordRuleEditorRef = ref<InstanceType<typeof RecordRuleEditor>>();
const codeResolverEditorRef = ref<InstanceType<typeof CodeResolverEditor>>();

const currentComponentName = window.document.title as ComponentName;

function messageListener(evt: MessageEvent<MessageEventData>) {
  const { data } = evt;
  const { command, componentName, value } = data;
  // console.log("[App.vue] at messageListener ", command, value);

  switch (componentName) {
    case "DBFormView":
      dBFormViewRef.value?.recieveMessage(data);
      break;
    case "MdhPanel":
      mdhPanelRef.value?.recieveMessage(data);
      break;
    case "HttpResponsesPanel":
      httpResponsesPanelRef.value?.recieveMessage(data);
      break;
    case "DiffPanel":
      diffPanelRef.value?.recieveMessage(data);
      break;
    case "ScanPanel":
      scanPanelRef.value?.recieveMessage(data);
      break;
    case "ViewConditionPanel":
      viewConditionPanelRef.value?.recieveMessage(data);
      break;
    case "VariablesPanel":
      variablesPanelRef.value?.recieveMessage(data);
      break;
    case "WriteToClipboardParamsPanel":
      writeToClipboardParamsPanelRef.value?.recieveMessage(data);
      break;
    case "NotebookCellMetadataPanel":
      notebookCellMetadataPanelRef.value?.recieveMessage(data);
      break;
    case "ERDiagramSettingsPanel":
      eRDiagramSettingsPanelRef.value?.recieveMessage(data);
      break;
    case "RecordRuleEditor":
      recordRuleEditorRef.value?.recieveMessage(data);
      break;
    case "CodeResolverEditor":
      codeResolverEditorRef.value?.recieveMessage(data);
      break;
  }
}

onMounted(() => {
  window.removeEventListener("message", messageListener);
  window.addEventListener("message", messageListener);
});
</script>

<template>
  <main>
    <DBFormView v-if="currentComponentName === 'DBFormView'" ref="dBFormViewRef" />

    <MdhPanel v-if="currentComponentName === 'MdhPanel'" ref="mdhPanelRef" />

    <HttpResponsesPanel
      v-if="currentComponentName === 'HttpResponsesPanel'"
      ref="httpResponsesPanelRef"
    />

    <DiffPanel v-if="currentComponentName === 'DiffPanel'" ref="diffPanelRef" />

    <ScanPanel v-if="currentComponentName === 'ScanPanel'" ref="scanPanelRef" />

    <ViewConditionPanel
      v-if="currentComponentName === 'ViewConditionPanel'"
      ref="viewConditionPanelRef"
    />

    <VariablesPanel v-if="currentComponentName === 'VariablesPanel'" ref="variablesPanelRef" />

    <WriteToClipboardParamsPanel
      v-if="currentComponentName === 'WriteToClipboardParamsPanel'"
      ref="writeToClipboardParamsPanelRef"
    />

    <ERDiagramSettings
      v-if="currentComponentName === 'ERDiagramSettingsPanel'"
      ref="eRDiagramSettingsPanelRef"
    />

    <NotebookCellMetadataPanel
      v-if="currentComponentName === 'NotebookCellMetadataPanel'"
      ref="notebookCellMetadataPanelRef"
    />

    <RecordRuleEditor
      v-if="currentComponentName === 'RecordRuleEditor'"
      ref="recordRuleEditorRef"
    />

    <CodeResolverEditor
      v-if="currentComponentName === 'CodeResolverEditor'"
      ref="codeResolverEditorRef"
    />
  </main>
</template>
