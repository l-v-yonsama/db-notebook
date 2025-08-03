<template>
  <div class="labeld-text">
    <label :for="id">{{ label }}</label>
    <p v-if="isShowMode" :id="id">
      {{ showModeValue ? showModeValue : modelValue }}
    </p>
    <VsCodeTextField v-else :id="id" v-model="inputValue" :placeholder="placeholder" :maxlength="128"></VsCodeTextField>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import VsCodeTextField from "./VsCodeTextField.vue";

const props = defineProps<{
  modelValue: string | number | undefined;
  label: string;
  placeholder: string;
  isShowMode: boolean;
  showModeValue?: string;
  id: string;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string | number | Date | undefined): void;
}>();

const inputValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

</script>
<style lang="scss" scoped>
div.labeld-text {
  p {
    margin: 0.3rem 0 0 0.3rem;
    opacity: 0.7;
  }

  label {
    display: block;
    margin: 0.5rem 0 1px 0;
  }
}
</style>
