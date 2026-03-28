<template>
  <!-- <vscode-radio-group :value="modelValue || value" @change="handleOnChange">
    <slot></slot>
  </vscode-radio-group> -->
  <vscode-dropdown :value="modelValue" :class="{ transparent, verr: isError }" :disabled="disabled"
    @change="handleOnChange" @focus="handleOnFocus" @blur="handleOnBlur" :style="{ 'z-index': calcZIndex }">
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
import { computed, ref, watch } from "vue";
provideVSCodeDesignSystem().register(vsCodeDropdown(), vsCodeOption());

type Props = {
  id?: string;
  items: DropdownItem[];
  modelValue: string | number;
  transparent?: boolean;
  required?: boolean;
  disabled?: boolean;
  baseZIndex?: number;
};

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  modelValue: "",
  baseZIndex: 100
});

const hasFocus = ref(false);
const isError = ref(false);

const calcZIndex = computed((): number => props.baseZIndex + (hasFocus.value ? 100 : 0));

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
  (event: "onFocus", modelValue: string | number): void;
  (event: "onBlur", modelValue: string | number): void;
}>();

function handleOnChange(event: any) {
  emit("update:modelValue", event.target.value);
  emit("change", event);
}

function handleOnFocus(event: any) {
  console.log('onFocus', event.target.value);
  hasFocus.value = true;
  emit("onFocus", event.target.value);
}

function handleOnBlur(event: any) {
  console.log('onBlur', event.target.value);
  hasFocus.value = false;
  emit("onBlur", event.target.value);
}

</script>
<style>
vscode-dropdown[transparent]::part(root) {
  background-color: transparent !important;
}
</style>
