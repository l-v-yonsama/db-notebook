<template>
  <!-- <vscode-radio-group :value="modelValue || value" @change="handleOnChange">
    <slot></slot>
  </vscode-radio-group> -->
  <vscode-dropdown :value="selectedValue" :class="{ transparent, verr: isError }" :disabled="disabled"
    @change="handleOnChange" @focus="handleOnFocus" @blur="handleOnBlur" :style="dropdownStyle">
    <!-- <vscode-option value="" aria-disabled="true" style="display: none">-- Select --</vscode-option> -->
    <vscode-option v-for="(item, index) in items" :key="index" :value="String(item.value)">
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
  width?: number;
};

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  modelValue: "",
  baseZIndex: 100
});

const hasFocus = ref(false);
const isError = ref(false);
// The toolkit's custom elements compare option values as strings even when
// Vue receives a numeric model. Normalize only at that DOM boundary; change
// events below map back to the original DropdownItem value type.
const selectedValue = computed(() => String(props.modelValue ?? ""));

const calcZIndex = computed((): number => props.baseZIndex + (hasFocus.value ? 100 : 0));

const dropdownStyle = computed(() => {
  const style: Record<string, string | number> = {
    "z-index": calcZIndex.value,
  };
  if (props.width !== undefined) {
    style.width = `${props.width}px`;
  }
  return style;
});

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
  const domValue = String(event.target.value ?? "");
  const value = props.items.find((item) => String(item.value) === domValue)?.value ?? domValue;
  emit("update:modelValue", value);
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
