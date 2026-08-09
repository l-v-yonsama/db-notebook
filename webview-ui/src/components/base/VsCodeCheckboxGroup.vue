<template>
  <div>
    <fieldset>
      <legend v-if="legend">{{ legend }}</legend>
      <template v-for="item of items" :key="`${item.value}:${modelValue.includes(item.value)}`">
        <div v-if="itemWrapper" class="checkbox-option-wrapper">
          <vscode-checkbox
            :value="item.value"
            :disabled="item.disabled"
            :checked="modelValue.includes(item.value)"
            @change="($e:InputEvent) => clickBox(item.value, $e)"
            ><span class="checkbox-label">{{ item.label }}</span></vscode-checkbox
          >
        </div>
        <vscode-checkbox
          v-else
          :value="item.value"
          :disabled="item.disabled"
          :checked="modelValue.includes(item.value)"
          @change="($e:InputEvent) => clickBox(item.value, $e)"
          ><span class="checkbox-label">{{ item.label }}</span></vscode-checkbox
        >
      </template>
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
    itemWrapper?: boolean;
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
    itemWrapper: false,
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

.checkbox-option-wrapper {
  width: 100%;
  margin: 7px 0;
}

.checkbox-option-wrapper vscode-checkbox {
  display: inline-flex;
  width: auto;
}
</style>
