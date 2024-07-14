<script setup lang="ts">
import type { NodeRunAxiosEvent } from "@/utilities/vscode";
import type { ContentTypeInfo } from "@l-v-yonsama/rdh";
import {
  provideVSCodeDesignSystem,
  vsCodePanels,
  vsCodePanelTab,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import { ref } from "vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

type Props = {
  width: number;
  height: number;
  res: NodeRunAxiosEvent;
  headerCodeBlock: string;
  paramCodeBlock: string;
  contentsCodeBlock: string;
  previewContentTypeInfo: ContentTypeInfo | undefined;
};

const props = defineProps<Props>();

const width = Math.max(10, props.width - 4);
const height = Math.max(10, props.height - 83);

const imgSrc = ref("");

const status = ref(
  `${props.res.entry.response.status} ${props.res.entry.response.statusText} ${
    Math.floor(props.res.entry.response.status / 100) <= 3 ? "😀" : "😱"
  }`
);

const activeTabId = ref("data");

type TabItemType = {
  tabId: string;
  title: string;
  isCode: boolean;
};
const tabItems = ref([
  {
    tabId: "headers",
    title: "Headers",
    isCode: true,
  },
  {
    tabId: "params",
    title: "Params",
    isCode: true,
  },
  {
    tabId: "data",
    title: "Data",
    isCode: true,
  },
] as TabItemType[]);

const showTab = (tabId: string) => {
  activeTabId.value = tabId;
  reset();
};

const reset = () => {};

reset();
</script>

<template>
  <section class="HttpRequestViewer">
    <p class="header-summary">
      <label for="status">STATUS:</label><span id="status">{{ status }}</span>
      <label for="elapsed-time">Elapsed Time:</label
      ><span id="elapsed-time">{{ Math.round(props.res.entry.time) ?? "-" }}msec</span>
    </p>
    <VsCodeTabHeader
      v-for="tabItem in tabItems"
      :id="tabItem.tabId"
      :key="tabItem.tabId"
      :title="`${tabItem.title}`"
      :is-active="activeTabId === tabItem.tabId"
      :closable="false"
      @click="showTab(tabItem.tabId)"
    >
    </VsCodeTabHeader>
    <vscode-panel-view id="view-headers" class="panel-view">
      <div v-if="activeTabId === 'headers'" class="code" :style="{ height: `${height}px` }">
        <section v-if="headerCodeBlock" v-html="headerCodeBlock"></section>
        <span v-else>No headers</span>
      </div>
    </vscode-panel-view>
    <vscode-panel-view id="view-params" class="panel-view">
      <div v-if="activeTabId === 'params'" class="code" :style="{ height: `${height}px` }">
        <section v-if="paramCodeBlock" v-html="paramCodeBlock"></section>
        <span v-else>No params</span>
      </div>
    </vscode-panel-view>
    <vscode-panel-view id="view-data" class="panel-view">
      <div v-if="activeTabId === 'data'" class="code" :style="{ height: `${height}px` }">
        <section v-if="contentsCodeBlock" v-html="contentsCodeBlock"></section>
        <span v-else>No data</span>
      </div>
    </vscode-panel-view>
  </section>
</template>

<style lang="scss" scoped>
section.HttpRequestViewer {
  vscode-panel-view {
    padding: 0 6px !important;
    & > div {
      margin: 4px;
    }
  }

  .header-summary {
    label {
      font-weight: bold;
      margin-right: 3px;
    }
    span {
      margin-right: 6px;
      font-size: smaller;
    }
  }

  .panel-view {
    width: 100%;
    height: 100%;

    div.code {
      width: 100%;
      overflow: auto;
      white-space: pre;
    }
  }
}
</style>
