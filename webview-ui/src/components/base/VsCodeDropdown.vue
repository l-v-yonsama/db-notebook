<template>
  <!-- <vscode-radio-group :value="modelValue || value" @change="handleOnChange">
    <slot></slot>
  </vscode-radio-group> -->
  <vscode-dropdown :value="modelValue" :class="{ transparent, verr: isError }" :disabled="disabled"
    @change="handleOnChange">
    <!-- <vscode-option value="" aria-disabled="true" style="display: none">-- Select --</vscode-option> -->
    <vscode-option v-for="(item, index) in items" :key="index" :value="item.value">
      {{ item.label }}
    </vscode-option>
  </vscode-dropdown>
</template>

<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import {
  provideVSCodeDesignSystem,
  vsCodeDropdown,
  vsCodeOption,
} from "@vscode/webview-ui-toolkit";
import { ref, watch } from "vue";
provideVSCodeDesignSystem().register(vsCodeDropdown(), vsCodeOption());

type Props = {
  id?: string;
  items: DropdownItem[];
  modelValue: string | number;
  transparent?: boolean;
  required?: boolean;
  disabled?: boolean;
};

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  modelValue: "",
});

const isError = ref(false);

watch(
  () => props.modelValue,
  () => {
    isError.value = props.required === true && (props.modelValue ?? "").toString().length === 0;
  },
  {
    immediate: true,
  }
);

const emit = defineEmits<{
  (event: "change", value: any): void;
  (event: "update:modelValue", modelValue: string | number): void;
}>();

function handleOnChange(event: any) {
  emit("update:modelValue", event.target.value);
  emit("change", event);
}
</script>
<style>
vscode-dropdown[transparent]::part(root) {
  background-color: transparent !important;
}
</style>
