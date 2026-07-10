<template>
  <div class="dropdown-area">
    <label>{{ label }}:</label>
    <VsCodeTextField
      v-if="chartDataItems.length === 1"
      :transparent="true"
      :required="required === true"
      v-model="v"
      @change="changeCondition"
    />
    <VsCodeDropdown
      v-else
      v-model="v"
      :transparent="true"
      :required="required === true"
      :items="chartDataItems"
      @change="changeCondition"
    />
  </div>
</template>

<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import { ref, watch } from "vue";
import VsCodeDropdown from "./VsCodeDropdown.vue";
import VsCodeTextField from "./VsCodeTextField.vue";

const props = defineProps<{
  modelValue: string | number;
  label: string;
  chartDataItems: DropdownItem[];
  required?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string | number | Date): void;
}>();

const v = ref(props.modelValue);

watch(
  () => props.modelValue,
  (value) => {
    v.value = value;
  }
);

const changeCondition = (e: any) => {
  emit("update:modelValue", v.value);
};

function handleOnInput(event: any) {
  emit("update:modelValue", event.target.value);
}
</script>
<style lang="scss" scoped>
div.dropdown-area {
  margin-bottom: 3px;
  & > label {
    margin-top: 5px;
    display: inline-block;
    margin-right: 5px;
    min-width: 85px;
  }
}
</style>
