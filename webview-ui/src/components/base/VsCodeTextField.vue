<template>
  <vscode-text-field
    :value="modelValue"
    @input="handleOnInput"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :maxlength="maxlength"
    :min="min"
    :size="size"
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
  min?: number;
  size?: number;
}>();
const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string | number): void;
}>();

function handleOnInput(event: any) {
  emit("update:modelValue", event.target.value);
}
</script>
<style scoped>
div.mask-wrapper {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: row;
  color: #cccccc;
  background: #2a2a2a;
  border-radius: 1px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}
div.mask-root {
  outline: none;
  user-select: none;
  display: inline-block;
  color: inherit;
  background-color: transparent;
  border: solid 1px transparent;
  box-sizing: border-box;
  font-size: var(--type-ramp-base-font-size);
  line-height: var(--type-ramp-base-line-height);
  padding: 2px 4px;
}
.mask-control {
  appearance: none;
  font-style: inherit;
  font-variant: inherit;
  font-weight: inherit;
  font-stretch: inherit;
  font-family: inherit;
  background: transparent;
  color: inherit;
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  border: none;
}
</style>
