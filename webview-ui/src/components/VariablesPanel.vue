<script setup lang="ts">
import type { VariablesPanelEventData } from "@/utilities/vscode";
import type { ResultSetData } from "@l-v-yonsama/rdh";
import { nextTick, onMounted, ref } from "vue";
import RDHViewer from "./RDHViewer.vue";

const rdh = ref(undefined as ResultSetData | undefined);

const splitterWidth = ref(300);
const splitterHeight = ref(300);

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.VariablesPanel");
  if (sectionWrapper?.clientHeight) {
    splitterHeight.value = sectionWrapper?.clientHeight - 3;
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = sectionWrapper.clientWidth - 14;
  }
};

const initialize = (v: VariablesPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  rdh.value = v.variables;
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
  setTimeout(resetSpPaneWrapperHeight, 50);
  setTimeout(resetSpPaneWrapperHeight, 200);
});

const recieveMessage = (data: VariablesPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="VariablesPanel">
    <RDHViewer
      v-if="rdh"
      :rdh="rdh"
      :width="splitterWidth"
      :height="splitterHeight"
      :readonly="true"
    />
  </section>
</template>

<style scoped>
section.VariablesPanel {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;
}
</style>
