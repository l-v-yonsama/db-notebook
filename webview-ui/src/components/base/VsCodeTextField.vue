<template>
  <vscode-text-field
    class="child"
    :class="{ transparent: isTransparent }"
    :value="modelValue"
    @input="handleOnInput"
    @focus="handleOnFocus"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :maxlength="maxlength"
    :min="min"
    :size="size"
    :readonly="readonly"
  >
    <slot></slot>
  </vscode-text-field>
</template>

<script setup lang="ts">
import { vsCodeTextField, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";

provideVSCodeDesignSystem().register(vsCodeTextField());

const props = defineProps<{
  modelValue?: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  maxlength?: number;
  readonly?: boolean;
  isTransparent?: boolean;
  min?: number;
  size?: number;
}>();
const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string | number): void;
  (event: "onCellFocus", modelValue: string | number): void;
}>();

function handleOnInput(event: any) {
  emit("update:modelValue", event.target.value);
}
function handleOnFocus(event: any) {
  emit("onCellFocus", event.target.value);
}
</script>
<style>
vscode-text-field[transparent]::part(root) {
  background-color: transparent !important;
}
</style>
