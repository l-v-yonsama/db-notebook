<template>
  <vscode-button
    @click="handleOnClick"
    :title="title"
    :appearance="appearance"
    :disabled="disabled"
    :aria-label="ariaLabel ?? title"
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
  // Only needed when the button's slot content isn't readable text on its
  // own (e.g. an icon-only button) - falls back to `title` so existing
  // icon+label buttons keep an accessible name without every call site
  // having to pass both.
  ariaLabel?: string;
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
