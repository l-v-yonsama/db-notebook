<template>
  <vscode-radio-group :value="modelValue" @change="handleOnChange">
    <vscode-radio
      v-for="item of items"
      :value="item.value"
      :key="item.value"
      :disabled="item.disabled"
      :checked="modelValue == item.value"
      @change="($e:InputEvent) => clickBox(item.value, $e)"
      >{{ item.label }}</vscode-radio
    >
  </vscode-radio-group>
</template>

<script setup lang="ts">
import {
  provideVSCodeDesignSystem,
  vsCodeRadio,
  vsCodeRadioGroup,
} from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeRadioGroup(), vsCodeRadio());

const props = withDefaults(
  defineProps<{
    id?: string;
    items: {
      label: string;
      value: string | number;
      disabled?: boolean;
      checked?: boolean;
    }[];
    modelValue: string | number;
  }>(),
  {
    legend: "",
    items: () => [],
    modelValue: "",
  }
);

const clickBox = (value: string | number, $e: InputEvent) => {
  emit("update:modelValue", value);
  // emit("change", {});
};

const emit = defineEmits<{
  (event: "change", value: any): void;
  (event: "update:modelValue", modelValue: number | string): void;
}>();

function handleOnChange(event: any) {
  emit("update:modelValue", event.target.value);
  emit("change", event);
}
</script>
<style>
vscode-radio-group {
  margin-top: 1px;
  margin-bottom: 1px;
}
</style>
