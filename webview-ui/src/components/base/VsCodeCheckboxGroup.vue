<template>
  <div>
    <fieldset>
      <legend v-if="legend">{{ legend }}</legend>
      <vscode-checkbox
        v-for="item of items"
        :value="item.value"
        :key="item.value"
        :disabled="item.disabled"
        :checked="modelValue.includes(item.value)"
        @change="($e:InputEvent) => clickBox(item.value, $e)"
        >{{ item.label }}</vscode-checkbox
      >
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeCheckbox());

const clickBox = (value: string, $e: InputEvent) => {
  let updatedValue = [...props.modelValue];
  const idx = updatedValue.findIndex((v) => value == v);
  if (idx >= 0) {
    updatedValue.splice(idx, 1);
  } else {
    updatedValue.push(value);
  }
  emit("update:modelValue", updatedValue);
  emit("change", {});
  emit("click", value);
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

// watch(
//   () => props.items,
//   () => {
//     hoge.value = props.hoge;
//   }
// );

// const list = ref(
//   props.items.map((it) => ({
//     label: it.label,
//     value: it.value,
//     disabled: it.disabled ?? false,
//     checked: props.modelValue.includes(it.value),
//   }))
// );

// props.items
//   .filter((it) => it.checked === true)
//   .forEach((item) => {
//     selectedValues.push(item.value);
//   });

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string[]): void;
  (event: "change", value: any): void;
  (event: "click", value: string): void;
}>();
</script>
<style scoped>
fieldset {
  text-align: left;
}
</style>
