<template>
  <vscode-text-field
    class="child"
    :class="{ transparent: isTransparent, verr: isError }"
    :value="modelValue"
    @input="handleOnInput"
    @focus="handleOnFocus"
    @mouseout="handleOnMouseOut"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :maxlength="maxlength"
    :min="min"
    :max="max"
    :size="size"
    :readonly="readonly"
  >
    <span v-if="isError" slot="end" class="codicon codicon-error"></span>
  </vscode-text-field>
</template>

<script setup lang="ts">
import { vsCodeTextField, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
import { nextTick, ref, watch } from "vue";

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
  max?: number;
  size?: number;
  required?: boolean;
  changeOnMouseout?: boolean;
}>();

const isError = ref(false);
const initialValue = props.modelValue ?? "";

watch(
  () => props.modelValue,
  () => {
    let error = false;
    if (props.required && (props.modelValue ?? "").toString().length === 0) {
      error = true;
    }
    const v = (props.modelValue ?? "").toString();
    if (props.type === "number" && v.length > 0) {
      const n = Number(v);
      if (isNaN(n)) {
        error = true;
      } else {
        if (props.min !== undefined && n < props.min) {
          error = true;
        }
        if (props.max !== undefined && n > props.max) {
          error = true;
        }
      }
    }
    isError.value = error;
  },
  {
    immediate: true,
  }
);

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string | number): void;
  (event: "onFocusCell", modelValue: string | number): void;
}>();

function handleOnInput(event: any) {
  emit("update:modelValue", event.target.value);
}
function handleOnFocus(event: any) {
  emit("onFocusCell", event.target.value);
}
function handleOnMouseOut(event: any) {
  if (props.changeOnMouseout === true && initialValue != event.target.value) {
    nextTick(() => event.target.blur());
  }
}
</script>
<style>
vscode-text-field[transparent]::part(root) {
  background-color: transparent !important;
}
</style>
