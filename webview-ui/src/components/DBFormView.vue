<script setup lang="ts">
import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { defineExpose, nextTick, reactive, ref } from "vue";
import type { DBFormEventData, ModeType } from "../utilities/vscode";
import ConnectionSettingVue from "./form/ConnectionSetting.vue";
import ResourceProperties from "./form/ResourceProperties.vue";

const visible = reactive<{
  connectionSetting: boolean;
  resourceProperties: boolean;
}>({
  connectionSetting: false,
  resourceProperties: false,
});

const mode = ref<ModeType>("create");
const connectionSettingRef = ref<InstanceType<typeof ConnectionSettingVue>>();
const setConnectionSettingRef = (el: any) => {
  connectionSettingRef.value = el;
};

const prohibitedNames = ref<string[]>([]);
const settingItem = ref<ConnectionSetting | undefined>(undefined);
const resourcePropertiesValues = ref<{ [key: string]: string }>({});

const recieveMessage = (data: DBFormEventData) => {
  const { command, value } = data;

  if (command === "initialize") {
    visible.connectionSetting = false;
    visible.resourceProperties = false;
  }

  switch (value.subComponentName) {
    case "ConnectionSetting":
      if (command === "initialize") {
        nextTick(() => {
          if (value.connectionSetting === undefined) {
            return;
          }
          mode.value = value.connectionSetting.mode;
          settingItem.value = value.connectionSetting.setting;
          prohibitedNames.value.splice(
            0,
            prohibitedNames.value.length,
            ...value.connectionSetting.prohibitedNames
          );
          visible.connectionSetting = true;
        });
      }
      if (command === "stop-progress") {
        connectionSettingRef.value?.stopProgress();
      }
      if (command === "selectedFile") {
        connectionSettingRef.value?.selectedFile(value.selectedFilePath ?? "");
      }
      break;
    case "ResourceProperties":
      nextTick(() => {
        if (value.resourceProperties === undefined) {
          return;
        }
        resourcePropertiesValues.value = value.resourceProperties;
        visible.resourceProperties = true;
      });
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
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
</template>

<style scoped></style>
