<template>
  <!-- <vscode-radio-group :value="modelValue || value" @change="handleOnChange">
    <slot></slot>
  </vscode-radio-group> -->
  <vscode-dropdown :value="modelValue" @change="handleOnChange">
    <!-- <vscode-option value="" aria-disabled="true" style="display: none">-- Select --</vscode-option> -->
    <vscode-option v-for="(item, index) in items" :key="index" :value="item.value">
      {{ item.label }}
    </vscode-option>
  </vscode-dropdown>
</template>

<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import {
  vsCodeDropdown,
  vsCodeOption,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeDropdown(), vsCodeOption());

type Props = {
  items: DropdownItem[];
  modelValue: string | number;
};

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  modelValue: "",
});

const emit = defineEmits<{
  (event: "change", value: any): void;
  (event: "update:modelValue", modelValue: string | number): void;
}>();

function handleOnChange(event: any) {
  emit("change", event);
  emit("update:modelValue", event.target.value);
}
</script>
<style></style>
