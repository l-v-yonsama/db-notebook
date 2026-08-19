<template>
  <!-- .toolbar / .tool-left / .tool-right styles are defined globally in assets/scss/main.scss -->
  <div class="toolbar">
    <div class="tool-left">
      <slot name="left"></slot>
    </div>
    <div class="tool-right">
      <!-- Close/Cancel always sits last (rightmost) in this group, matching
           ToolsView.vue's hand-rolled toolbar - see the toolbar UI alignment
           notes in ViewConditionPanel.vue/ERDiagramSettings.vue/
           PerformanceTuningPreviewPanel.vue for the panels this was aligned
           against. -->
      <slot></slot>
      <VsCodeButton
        appearance="secondary"
        :title="cancelTitle"
        :disabled="cancelDisabled"
        @click="handleOnCancel"
      >
        <fa icon="times" />{{ cancelLabel }}
      </VsCodeButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import VsCodeButton from "./VsCodeButton.vue";

withDefaults(
  defineProps<{
    cancelLabel?: string;
    cancelTitle?: string;
    cancelDisabled?: boolean;
  }>(),
  {
    cancelLabel: "Cancel",
    cancelTitle: "Cancel",
  }
);

const emit = defineEmits<{
  (event: "cancel"): void;
}>();

const handleOnCancel = () => {
  emit("cancel");
};
</script>
<style scoped></style>
