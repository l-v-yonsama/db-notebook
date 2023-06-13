<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import type { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import RDHViewer from "./RDHViewer.vue";
import type { CellFocusParams } from "@/types/RdhEvents";

type Props = {
  rdh: ResultSetData;
};

const props = defineProps<Props>();
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

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
  setTimeout(resetSpPaneWrapperHeight, 50);
  setTimeout(resetSpPaneWrapperHeight, 200);
});

const onCellFocus = (params: CellFocusParams): void => {
  // openLogStreamParams.value.canAction = false;
  // console.log("onCellFocus:", params);
  // const tabItem = getActiveTabItem();
  // console.log("tabItem=", tabItem);
  // if (!tabItem) {
  //   console.log("No tab Item");
  //   return;
  // }
  // const logGroupName = tabItem.title;
  // const logStream = params.rowValues["@logStream"];
  // const startTime = params.rowValues["@timestamp"];
  // if (tabItem.rootRes["resourceType"] === "LogGroup") {
  //   openLogStreamParams.value.parentTabId = tabItem.tabId;
  //   openLogStreamParams.value.logGroupName = logGroupName;
  //   openLogStreamParams.value.logStream = logStream;
  //   openLogStreamParams.value.startTime = startTime;
  //   openLogStreamParams.value.canAction = true;
  // }
};
</script>

<template>
  <section class="VariablesPanel">
    <RDHViewer
      :rdh="rdh"
      :width="splitterWidth"
      :height="splitterHeight"
      :readonly="true"
      @onCellFocus="onCellFocus"
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
