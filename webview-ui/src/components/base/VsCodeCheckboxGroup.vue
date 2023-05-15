<template>
  <div>
    <fieldset>
      <legend v-if="legend">{{ legend }}</legend>
      <vscode-checkbox
        v-for="item of list"
        :value="item.value"
        :key="item.value"
        :disabled="item.disabled"
        :checked="item.checked"
        @click="clickBox(item.value)"
        >{{ item.label }}</vscode-checkbox
      >
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
import { ref } from "vue";
provideVSCodeDesignSystem().register(vsCodeCheckbox());

const selectedValues: string[] = [];

const clickBox = (value: string) => {
  const idx = selectedValues.findIndex((v) => value === v);
  if (idx >= 0) {
    selectedValues.splice(idx, 1);
  } else {
    selectedValues.push(value);
  }
  emit("update:modelValue", selectedValues);
};

const props = withDefaults(
  defineProps<{
    legend?: string;
    items: {
      label: string;
      value: string;
      disabled?: boolean;
      checked?: boolean;
    }[];
    modelValue: string[];
  }>(),
  {
    legend: "",
    items: () => [],
    modelValue: () => [],
  }
);

const list = ref(
  props.items.map((it) => ({
    label: it.label,
    value: it.value,
    disabled: it.disabled ?? false,
    checked: props.modelValue.includes(it.value),
  }))
);

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string[]): void;
}>();
</script>
<style></style>
