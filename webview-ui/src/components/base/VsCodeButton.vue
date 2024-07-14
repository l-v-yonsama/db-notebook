<template>
  <vscode-button
    @click="handleOnClick"
    :title="title"
    :appearance="appearance"
    :disabled="disabled"
  >
    <slot></slot>
  </vscode-button>
</template>

<script setup lang="ts">
import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeButton());

const props = defineProps<{
  appearance?: string;
  disabled?: boolean;
  title?: string;
}>();
const emit = defineEmits<{
  (event: "click", value: any): void;
}>();

function handleOnClick(event: any) {
  emit("click", event);
}
</script>
<style scoped>
vscode-button:hover {
  background-color: var(--vscode-toolbar-hoverBackground);
}
</style>
