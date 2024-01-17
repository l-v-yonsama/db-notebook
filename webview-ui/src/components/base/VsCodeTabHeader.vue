<template>
  <vscode-panel-tab
    :id="'tab-' + id"
    @mouseover="hovering = true"
    @mouseleave="hovering = false"
    :aria-selected="isActive"
    @click="clicked"
  >
    {{ title }}
    <div v-if="closable" class="close-action">
      <VsCodeButton v-show="isActive || hovering" appearance="icon" @click="close($event)"
        ><span class="codicon codicon-chrome-close"></span
      ></VsCodeButton>
    </div>
    <span v-else style="padding-right: 4px">&nbsp;</span>
  </vscode-panel-tab>
</template>

<script setup lang="ts">
import { vsCodePanelTab, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
import { ref } from "vue";
import VsCodeButton from "./VsCodeButton.vue";

provideVSCodeDesignSystem().register(vsCodePanelTab());

const props = defineProps<{
  id: string | number;
  title: string;
  isActive: boolean;
  closable: boolean;
}>();

const hovering = ref(false);

const emit = defineEmits<{
  (event: "clicked", id: string | number): void;
  (event: "close", id: string | number): void;
}>();

function clicked() {
  emit("clicked", props.id);
}

function close(e: Event) {
  e.stopPropagation();
  emit("close", props.id);
}
</script>
<style scoped></style>
