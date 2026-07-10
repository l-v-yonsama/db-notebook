<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import "./assets/scss/main.scss";
import { componentRegistry } from "./utilities/componentRegistry";
import type { ComponentName, MessageEventData } from "./utilities/vscode";
import { vscode } from "./utilities/vscode";

type MountedComponent = {
  recieveMessage: (data: MessageEventData) => void;
};

const activeRef = ref<MountedComponent>();

const currentComponentName = ref<ComponentName | null>(null);
currentComponentName.value = window.document.title as ComponentName;

const activeComponent = computed(() =>
  currentComponentName.value ? componentRegistry[currentComponentName.value] : undefined
);

function messageListener(evt: MessageEvent<MessageEventData>) {
  const { data } = evt;
  const { command, componentName, value } = data;
  console.log("[App.vue] at messageListener ", command, value);

  if (componentName === currentComponentName.value) {
    activeRef.value?.recieveMessage(data);
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
    <component :is="activeComponent" v-if="activeComponent" ref="activeRef" />
  </main>
</template>
