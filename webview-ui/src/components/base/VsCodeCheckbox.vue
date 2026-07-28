<template>
  <vscode-checkbox :id="id" :checked="modelValue === true" :disabled="disabled" @change="handleOnChange">
    <slot></slot>
  </vscode-checkbox>
</template>

<script setup lang="ts">
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeCheckbox());

defineProps<{
  id?: string;
  modelValue?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: boolean): void;
  (event: "change", value: boolean): void;
}>();

function handleOnChange(event: any) {
  const checked = event?.target?.checked === true;
  // "update:modelValue" must be emitted before "change" so that
  // "change" listeners read the updated model value.
  emit("update:modelValue", checked);
  emit("change", checked);
}
</script>
<style scoped></style>
