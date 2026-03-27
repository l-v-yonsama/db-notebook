<template>
  <vscode-button class="copy-to-clipboard" @click="handleOnClick" :title="title" :appearance="appearance"
    :disabled="disabled">
    <fa v-if="state === 'idle'" icon="clipboard" />
    <fa v-else-if="state === 'loading'" icon="spinner" spin />
    <fa v-else-if="state === 'success'" icon="check" class="success" />
    <fa v-else icon="times" class="error" />
  </vscode-button>
</template>

<script setup lang="ts">
import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";
import { ref } from "vue";
provideVSCodeDesignSystem().register(vsCodeButton());

const state = ref<"idle" | "loading" | "success" | "error">("idle");

const props = defineProps<{
  content: string;
  appearance?: string;
  disabled?: boolean;
  title?: string;
}>();
const emit = defineEmits<{
  (event: "click", value: any): void;
}>();

function handleOnClick(event: any) {
  emit("click", event);
  state.value = "loading";

  try {
    navigator?.clipboard?.writeText(props.content);
    state.value = "success";
    setTimeout(() => (state.value = "idle"), 700);
  } catch {
    state.value = "error";
    setTimeout(() => (state.value = "idle"), 1000);
  }
}
</script>
<style lang="scss" scoped>
vscode-button:hover {
  background-color: var(--vscode-toolbar-hoverBackground);
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
}

.success {
  color: #4caf50;
}
</style>
