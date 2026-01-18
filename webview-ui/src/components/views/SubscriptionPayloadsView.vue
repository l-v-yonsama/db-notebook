<script setup lang="ts">
import type { CellFocusParams } from "@/types/RdhEvents";
import type {
  SubscriptionPayloadsViewEventData
} from "@/utilities/vscode";
import {
  vscode
} from "@/utilities/vscode";
import { abbr, type ResultSetData } from "@l-v-yonsama/rdh";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
import { nextTick, onMounted, ref } from "vue";
import RDHViewer from "../RDHViewer.vue";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

const subscriptionName = ref("");
const isSubscribed = ref(false);
const rdh = ref(null as ResultSetData | null);
const inProgress = ref(false);
const jsonExpansion = ref(false);
const splitterWidth = ref(300);
const splitterHeight = ref(300);

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.TopicPayloadsPanel");
  if (sectionWrapper?.clientHeight) {
    splitterHeight.value = Math.max(sectionWrapper?.clientHeight - 54, 10);
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = Math.max(sectionWrapper.clientWidth - 14, 10);
  }
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
});

const handleJSONExpansionOnChange = (newValue: boolean) => {
  jsonExpansion.value = newValue;
  vscode.postCommand({
    command: "ok",
    params: {
      jsonExpansion: jsonExpansion.value
    },
  });
};

const initialize = async (v: SubscriptionPayloadsViewEventData["value"]['initialize']) => {
  if (v === undefined) {
    return;
  }

  rdh.value = null;

  await nextTick();
  inProgress.value = false;
  subscriptionName.value = v.subscriptionName;
  isSubscribed.value = v.isSubscribed;
  rdh.value = v.rdh;
};

const setSearchResult = async (v: SubscriptionPayloadsViewEventData["value"]['searchResult']) => {
  if (v === undefined) {
    return;
  }
  rdh.value = null;
  await nextTick();
  isSubscribed.value = v.isSubscribed;
  rdh.value = v.rdh;
  inProgress.value = false;
};

const recieveMessage = (data: SubscriptionPayloadsViewEventData) => {
  const { command, value } = data;

  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
    case "set-search-result":
      if (value.searchResult === undefined) {
        return;
      }
      setSearchResult(value.searchResult);
      break;
  }
};

const onClickCell = (params: CellFocusParams): void => {
  // const tabItem = getActiveTabItem();
  // if (!tabItem) {
  //   return;
  // }

  // const innerIndex = rowIndexResolver.get(params.rowPos);
  // if (innerIndex !== undefined) {
  //   vscode.postCommand({
  //     command: "selectInnerTab",
  //     params: { tabId: tabItem.tabId, innerIndex },
  //   });
  // }
};

const close = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const subscribe = () => {
  inProgress.value = true;
  vscode.postCommand({
    command: "subscribe",
    params: {
      subscriptionName: subscriptionName.value
    },
  });
};

const unsubscribe = () => {
  inProgress.value = true;
  vscode.postCommand({
    command: "unsubscribe",
    params: {
      subscriptionName: subscriptionName.value
    },
  });
};

const output = (fileType: 'excel' | 'html'): void => {
  vscode.postCommand({
    command: "output",
    params: {
      tabId: "",
      fileType,
    },
  });
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="TopicPayloadsPanel">
    <div class="toolbar">
      <div class="tool-left">
        <label for="tableName">Topic:</label>
        <span id="tableName" :title="subscriptionName">{{ abbr(subscriptionName, 60) }}</span>
      </div>
      <div class="tab-container-actions">
        <vscode-checkbox :checked="jsonExpansion" @change="($e: any) => handleJSONExpansionOnChange($e.target.checked)"
          style="margin-right: 10px">Expand JSON column</vscode-checkbox>

        <button @click="close" :disabled="inProgress" title="Close view">
          <fa icon="times" />
        </button>
        <button @click="output('html')" :disabled="inProgress" title="Output as HTML">
          <fa icon="file-lines" />
        </button>
        <button @click="output('excel')" :disabled="inProgress" title="Output as Excel">
          <fa icon="file-excel" />
        </button>
        <button @click="subscribe" :disabled="inProgress" v-if="!isSubscribed" title="Subscribe">
          <fa icon="circle-xmark" />
        </button>
        <button @click="unsubscribe" :disabled="inProgress" v-if="isSubscribed" title="Unsubscribe">
          <fa icon="circle-xmark" />
        </button>
      </div>
    </div>

    <section class="panel-view" :style="{ width: `${splitterWidth}px` }">
      <div v-if="rdh" class="spPaneWrapper">
        <RDHViewer :rdh="rdh" :width="splitterWidth" :height="splitterHeight" @onClickCell="onClickCell" />
      </div>
      <div v-else class="centered-content">No payloads.</div>
    </section>
  </section>
</template>

<style lang="scss" scoped>
section.TopicPayloadsPanel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  .panel-view {
    padding: 4px;
    overflow: auto;
  }
}


.primary {
  color: var(--button-primary-foreground) !important;
  background: var(--button-primary-background) !important;
}
</style>
