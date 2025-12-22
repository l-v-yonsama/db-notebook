<script setup lang="ts">
import { onMounted, ref } from "vue";
import "./assets/scss/main.scss";
import type { ComponentName, MessageEventData } from "./utilities/vscode";
import { vscode } from "./utilities/vscode";

import Chat2QueryPanel from "./components/Chat2QueryPanel.vue";
import CreateInsertScriptSettingsPanel from "./components/CreateInsertScriptSettingsPanel.vue";
import CsvParseSettingPanel from "./components/CsvParseSettingPanel.vue";
import DBFormView from "./components/DBFormView.vue";
import HarFilePanel from "./components/HarFilePanel.vue";
import HttpEventPanel from "./components/HttpEventPanel.vue";
import LMPromptCreatePanel from "./components/LMPromptCreatePanel.vue";
import ChartsView from "./components/views/ChartsView.vue";
import CountRecordView from "./components/views/CountRecordView.vue";
import DiffMdhView from "./components/views/DiffMdhView.vue";
import MdhView from "./components/views/MdhView.vue";
import ToolsView from "./components/views/ToolsView.vue";

import DynamoQueryPanel from "./components/DynamoQueryPanel.vue";
import NotebookCellMetadataPanel from "./components/NotebookCellMetadataPanel.vue";
import PublishEditorPanel from "./components/PublishEditorPanel.vue";
import ScanPanel from "./components/ScanPanel.vue";
import SubscriptionSettingPanel from "./components/SubscriptionSettingPanel.vue";
import VariablesPanel from "./components/VariablesPanel.vue";
import ViewConditionPanel from "./components/ViewConditionPanel.vue";
import SubscriptionPayloadsView from "./components/views/SubscriptionPayloadsView.vue";
import WriteHttpEventToClipboardParamsPanel from "./components/WriteHttpEventToClipboardParamsPanel.vue";

import CodeResolverEditor from "./components/CodeResolverEditor.vue";
import type ERDiagramSettingsVue from "./components/ERDiagramSettings.vue";
import ERDiagramSettings from "./components/ERDiagramSettings.vue";
import RecordRuleEditor from "./components/RecordRuleEditor.vue";

const dBFormViewRef = ref<InstanceType<typeof DBFormView>>();
const MdhViewRef = ref<InstanceType<typeof MdhView>>();
const countRecordViewRef = ref<InstanceType<typeof CountRecordView>>();
const chartsViewRef = ref<InstanceType<typeof ChartsView>>();
const toolsViewRef = ref<InstanceType<typeof ToolsView>>();

const csvParseSettingPanelRef = ref<InstanceType<typeof CsvParseSettingPanel>>();
const createInsertScriptSettingsPanelRef =
  ref<InstanceType<typeof CreateInsertScriptSettingsPanel>>();
const httpEventPanelRef = ref<InstanceType<typeof HttpEventPanel>>();
const harFilePanelRef = ref<InstanceType<typeof HarFilePanel>>();
const lMPromptCreatePanelRef = ref<InstanceType<typeof LMPromptCreatePanel>>();
const chat2QueryPanelRef = ref<InstanceType<typeof Chat2QueryPanel>>();
const diffMdhViewRef = ref<InstanceType<typeof DiffMdhView>>();
const scanPanelRef = ref<InstanceType<typeof ScanPanel>>();
const dynamoQueryPanelRef = ref<InstanceType<typeof DynamoQueryPanel>>();
const viewConditionPanelRef = ref<InstanceType<typeof ViewConditionPanel>>();
const variablesPanelRef = ref<InstanceType<typeof VariablesPanel>>();
const writeHttpEventToClipboardParamsPanelRef =
  ref<InstanceType<typeof WriteHttpEventToClipboardParamsPanel>>();
const notebookCellMetadataPanelRef = ref<InstanceType<typeof NotebookCellMetadataPanel>>();
const eRDiagramSettingsPanelRef = ref<InstanceType<typeof ERDiagramSettingsVue>>();
const recordRuleEditorRef = ref<InstanceType<typeof RecordRuleEditor>>();
const codeResolverEditorRef = ref<InstanceType<typeof CodeResolverEditor>>();
const publishEditorPanelRef = ref<InstanceType<typeof PublishEditorPanel>>();
const subscriptionPayloadsViewRef = ref<InstanceType<typeof SubscriptionPayloadsView>>();
const subscriptionSettingPanelRef = ref<InstanceType<typeof SubscriptionSettingPanel>>();


const currentComponentName = ref<ComponentName | null>(null);
currentComponentName.value = window.document.title as ComponentName;

function messageListener(evt: MessageEvent<MessageEventData>) {
  const { data } = evt;
  const { command, componentName, value } = data;
  console.log("[App.vue] at messageListener ", command, value);

  switch (componentName) {
    case "DBFormView":
      dBFormViewRef.value?.recieveMessage(data);
      break;
    case "MdhView":
      MdhViewRef.value?.recieveMessage(data);
      break;
    case "ChartsView":
      chartsViewRef.value?.recieveMessage(data);
      break;
    case "Chat2QueryPanel":
      chat2QueryPanelRef.value?.recieveMessage(data);
      break;
    case "CountRecordView":
      countRecordViewRef.value?.recieveMessage(data);
      break;
    case "CreateInsertScriptSettingsPanel":
      createInsertScriptSettingsPanelRef.value?.recieveMessage(data);
      break;
    case "CsvParseSettingPanel":
      csvParseSettingPanelRef.value?.recieveMessage(data);
      break;
    case "HarFilePanel":
      harFilePanelRef.value?.recieveMessage(data);
      break;
    case "HttpEventPanel":
      httpEventPanelRef.value?.recieveMessage(data);
      break;
    case "PublishEditorPanel":
      publishEditorPanelRef.value?.recieveMessage(data);
      break;
    case "SubscriptionPayloadsView":
      subscriptionPayloadsViewRef.value?.recieveMessage(data);
      break;
    case "SubscriptionSettingPanel":
      subscriptionSettingPanelRef.value?.recieveMessage(data);
      break;
    case "LMPromptCreatePanel":
      lMPromptCreatePanelRef.value?.recieveMessage(data);
      break;
    case "DiffMdhView":
      diffMdhViewRef.value?.recieveMessage(data);
      break;
    case "ScanPanel":
      scanPanelRef.value?.recieveMessage(data);
      break;
    case "DynamoQueryPanel":
      dynamoQueryPanelRef.value?.recieveMessage(data);
      break;
    case "ViewConditionPanel":
      viewConditionPanelRef.value?.recieveMessage(data);
      break;
    case "VariablesPanel":
      variablesPanelRef.value?.recieveMessage(data);
      break;
    case "WriteHttpEventToClipboardParamsPanel":
      writeHttpEventToClipboardParamsPanelRef.value?.recieveMessage(data);
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
    case "ToolsView":
      toolsViewRef.value?.recieveMessage(data);
      break;
  }
}

onMounted(() => {
  window.removeEventListener("message", messageListener);
  window.addEventListener("message", messageListener);
  vscode.postCommand({
    command: "ready",
    params: {},
  });
});
</script>

<template>
  <main>
    <DBFormView v-if="currentComponentName === 'DBFormView'" ref="dBFormViewRef" />

    <MdhView v-if="currentComponentName === 'MdhView'" ref="MdhViewRef" />

    <HttpEventPanel v-if="currentComponentName === 'HttpEventPanel'" ref="httpEventPanelRef" />

    <LMPromptCreatePanel v-if="currentComponentName === 'LMPromptCreatePanel'" ref="lMPromptCreatePanelRef" />

    <Chat2QueryPanel v-if="currentComponentName === 'Chat2QueryPanel'" ref="chat2QueryPanelRef" />

    <CreateInsertScriptSettingsPanel v-if="currentComponentName === 'CreateInsertScriptSettingsPanel'"
      ref="createInsertScriptSettingsPanelRef" />

    <CsvParseSettingPanel v-if="currentComponentName === 'CsvParseSettingPanel'" ref="csvParseSettingPanelRef" />

    <HarFilePanel v-if="currentComponentName === 'HarFilePanel'" ref="harFilePanelRef" />

    <DiffMdhView v-if="currentComponentName === 'DiffMdhView'" ref="diffMdhViewRef" />

    <ScanPanel v-if="currentComponentName === 'ScanPanel'" ref="scanPanelRef" />

    <DynamoQueryPanel v-if="currentComponentName === 'DynamoQueryPanel'" ref="dynamoQueryPanelRef" />

    <PublishEditorPanel v-if="currentComponentName === 'PublishEditorPanel'" ref="publishEditorPanelRef" />

    <SubscriptionPayloadsView v-if="currentComponentName === 'SubscriptionPayloadsView'"
      ref="subscriptionPayloadsViewRef" />

    <SubscriptionSettingPanel v-if="currentComponentName === 'SubscriptionSettingPanel'"
      ref="subscriptionSettingPanelRef" />

    <ViewConditionPanel v-if="currentComponentName === 'ViewConditionPanel'" ref="viewConditionPanelRef" />

    <VariablesPanel v-if="currentComponentName === 'VariablesPanel'" ref="variablesPanelRef" />

    <WriteHttpEventToClipboardParamsPanel v-if="currentComponentName === 'WriteHttpEventToClipboardParamsPanel'"
      ref="writeHttpEventToClipboardParamsPanelRef" />

    <ERDiagramSettings v-if="currentComponentName === 'ERDiagramSettingsPanel'" ref="eRDiagramSettingsPanelRef" />

    <CountRecordView v-if="currentComponentName === 'CountRecordView'" ref="countRecordViewRef" />

    <ChartsView v-if="currentComponentName === 'ChartsView'" ref="chartsViewRef" />

    <NotebookCellMetadataPanel v-if="currentComponentName === 'NotebookCellMetadataPanel'"
      ref="notebookCellMetadataPanelRef" />

    <RecordRuleEditor v-if="currentComponentName === 'RecordRuleEditor'" ref="recordRuleEditorRef" />

    <CodeResolverEditor v-if="currentComponentName === 'CodeResolverEditor'" ref="codeResolverEditorRef" />

    <ToolsView v-if="currentComponentName === 'ToolsView'" ref="toolsViewRef" />

  </main>
</template>
