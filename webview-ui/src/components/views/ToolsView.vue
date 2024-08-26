<script setup lang="ts">
import type { CellFocusParams } from "@/types/RdhEvents";
import { vscode, type ToolsViewEventData } from "@/utilities/vscode";
import { toNum, type ResultSetData } from "@l-v-yonsama/rdh";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import RDHViewer from "../RDHViewer.vue";

const sectionWidth = ref(300);
const sectionHeight = ref(300);
const mode = ref("sessions" as ToolsViewEventData["value"]["refresh"]["mode"]);
const rdh = ref(undefined as ResultSetData | undefined);
const clickedCellParams = ref(undefined as CellFocusParams | undefined);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 76, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = sectionWrapper.clientWidth - 14;
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const refresh = async (v: ToolsViewEventData["value"]["refresh"]) => {
  if (v === undefined) {
    return;
  }

  mode.value = v.mode;
  rdh.value = undefined;

  await nextTick();
  rdh.value = v.rdh;
};

const close = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const output = (fileType: 'excel' | 'html'): void => {
  vscode.postCommand({
    command: "output",
    params: {
      tabId: "",
      fileType,
      displayOnlyChanged: false,
    },
  });
};

const searchAgain = (): void => {
  vscode.postCommand({
    command: "refresh",
    params: {
      tabId: "",
    },
  });
};

const kill = () => {
  if (clickedCellParams === undefined || clickedCellParams.value === undefined) {
    return;
  }
  const { rowValues } = clickedCellParams.value;
  if (rowValues === undefined) {
    return;
  }
  clickedCellParams.value = undefined;

  let sessionOrPid: number | undefined = undefined;
  if (rowValues['session_id']) {
    sessionOrPid = toNum(rowValues['session_id']);
  } else if (rowValues['pid']) {
    sessionOrPid = toNum(rowValues['pid']);
  }
  vscode.postCommand({
    command: "kill",
    params: {
      sessionOrPid
    },
  });
};

const recieveMessage = (data: ToolsViewEventData) => {
  const { command, value } = data;
  switch (command) {
    case "refresh":
      if (value.refresh === undefined) {
        return;
      }
      refresh(value.refresh);
      break;
  }
};

const onClickCell = (params: CellFocusParams): void => {
  clickedCellParams.value = params;
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <div class="toolbar">
      <div class="tool-left"></div>
      <div class="tool-right">
        <VsCodeButton @click="close" appearance="secondary" title="Close view">
          <fa icon="times" />Close view
        </VsCodeButton>
        <VsCodeButton @click="output('html')" appearance="secondary" title="Output as Html">
          <fa icon="file-lines" />Output as Html
        </VsCodeButton>
        <VsCodeButton @click="output('excel')" appearance="secondary" title="Output as Excel">
          <fa icon="file-excel" />Output as Excel
        </VsCodeButton>
        <VsCodeButton @click="searchAgain" appearance="secondary" title="Search again">
          <fa icon="rotate" />Refresh
        </VsCodeButton>
        <VsCodeButton :disabled="clickedCellParams === undefined" title="Count selected tables" @click="kill">
          <fa icon="circle-play" />Kill session
        </VsCodeButton>
      </div>
    </div>
    <section class="content">
      <RDHViewer v-if="rdh" :rdh="rdh" :width="sectionWidth" :height="sectionHeight" @onClickCell="onClickCell" />
    </section>
  </section>
</template>

<style lang="scss" scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 1px;
  padding: 1px;
}

.control {
  width: 110px;
  max-width: 110px;
}

div.scroll-wrapper {
  overflow: auto;
}
</style>
