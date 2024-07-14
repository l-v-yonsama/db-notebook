<template>
  <vscode-text-area
    :value="modelValue || value"
    @input="handleOnInput"
    :rows="rows"
    :cols="cols"
    :placeholder="placeholder"
    :maxlength="maxlength"
    :title="title"
  >
    <slot></slot>
  </vscode-text-area>
</template>

<script setup lang="ts">
import { provideVSCodeDesignSystem, vsCodeTextArea } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeTextArea());

const props = defineProps<{
  id?: string;
  modelValue?: string;
  value?: string;
  cols?: number;
  rows?: number;
  placeholder?: string;
  title?: string;
  maxlength?: number;
}>();
const emit = defineEmits<{
  (event: "input", value: any): void;
  (event: "update:modelValue", modelValue: number): void;
}>();

function handleOnInput(event: any) {
  emit("input", event);
  emit("update:modelValue", event.target.value);
}
</script>
<style></style>
